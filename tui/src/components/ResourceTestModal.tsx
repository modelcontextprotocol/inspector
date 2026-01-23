import React, { useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { uriTemplateToForm } from "../utils/uriTemplateToForm.js";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";

// Helper to extract error message from various error types
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}

interface ResourceTestModalProps {
  template: {
    name: string;
    uriTemplate: string;
    description?: string;
  };
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  onClose: () => void;
}

type ModalState = "form" | "loading" | "results";

interface ResourceResult {
  input: Record<string, string>;
  output: any;
  error?: string;
  errorDetails?: any;
  duration: number;
  uri: string;
}

export function ResourceTestModal({
  template,
  inspectorClient,
  width,
  height,
  onClose,
}: ResourceTestModalProps) {
  const [state, setState] = useState<ModalState>("form");
  const [result, setResult] = useState<ResourceResult | null>(null);
  const scrollViewRef = React.useRef<ScrollViewRef>(null);

  // Use full terminal dimensions instead of passed dimensions
  const [terminalDimensions, setTerminalDimensions] = React.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height,
  });

  React.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height,
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);

  const formStructure = uriTemplateToForm(
    template.uriTemplate,
    template.name || "Unknown Template",
  );

  // Reset state when modal closes
  React.useEffect(() => {
    return () => {
      // Cleanup: reset state when component unmounts
      setState("form");
      setResult(null);
    };
  }, []);

  // Handle all input when modal is open - prevents input from reaching underlying components
  // When in form mode, only handle escape (form handles its own input)
  // When in results mode, handle scrolling keys
  useInput(
    (input: string, key: Key) => {
      // Always handle escape to close modal
      if (key.escape) {
        setState("form");
        setResult(null);
        onClose();
        return;
      }

      if (state === "form") {
        // In form mode, let the form handle all other input
        // Don't process anything else - this prevents input from reaching underlying components
        return;
      }

      if (state === "results") {
        // Allow scrolling in results view
        if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.pageDown) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        } else if (key.pageUp) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        }
      }
    },
    { isActive: true },
  );

  const handleFormSubmit = async (values: Record<string, string>) => {
    if (!inspectorClient || !template) return;

    setState("loading");
    const startTime = Date.now();

    try {
      // Use InspectorClient's readResourceFromTemplate method which encapsulates template expansion and resource reading
      const response = await inspectorClient.readResourceFromTemplate(
        template.uriTemplate,
        values,
      );

      const duration = Date.now() - startTime;

      setResult({
        input: values,
        output: response,
        duration,
        uri: response.uri,
      });
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      // Try to get expanded URI from error if available, otherwise use template
      let uri = template.uriTemplate;
      // If the error response contains uri, use it
      if (error && typeof error === "object" && "uri" in error) {
        uri = (error as any).uri;
      }

      // Extract detailed error information
      const errorObj: any = {
        message: errorMessage,
      };
      if (error instanceof Error) {
        errorObj.name = error.name;
        errorObj.stack = error.stack;
      } else if (error && typeof error === "object") {
        // Try to extract more details from error object
        Object.assign(errorObj, error);
      } else {
        errorObj.error = String(error);
      }

      setResult({
        input: values,
        output: null,
        error: errorMessage,
        errorDetails: errorObj,
        duration,
        uri,
      });
      setState("results");
    }
  };

  // Calculate modal dimensions - use almost full screen
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;

  return (
    <Box
      position="absolute"
      width={terminalDimensions.width}
      height={terminalDimensions.height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      {/* Modal Content */}
      <Box
        width={modalWidth}
        height={modalHeight}
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor="black"
      >
        {/* Header */}
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            {formStructure.title}
          </Text>
          <Text> </Text>
          <Text dimColor>(Press ESC to close)</Text>
        </Box>

        {/* Content Area */}
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {state === "form" && (
            <Box flexGrow={1} flexDirection="column">
              {template.description && (
                <Box marginBottom={1} flexShrink={0}>
                  <Text dimColor>{template.description}</Text>
                </Box>
              )}
              <Form
                form={formStructure}
                onSubmit={(values: object) =>
                  handleFormSubmit(values as Record<string, string>)
                }
              />
            </Box>
          )}

          {state === "loading" && (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <Text color="yellow">Reading resource...</Text>
            </Box>
          )}

          {state === "results" && result && (
            <Box flexGrow={1} flexDirection="column" overflow="hidden">
              <ScrollView ref={scrollViewRef}>
                {/* Timing */}
                <Box marginBottom={1} flexShrink={0}>
                  <Text bold color="green">
                    Duration: {result.duration}ms
                  </Text>
                </Box>

                {/* URI */}
                <Box marginBottom={1} flexShrink={0}>
                  <Text bold color="cyan">
                    URI:{" "}
                  </Text>
                  <Text dimColor>{result.uri}</Text>
                </Box>

                {/* Input */}
                <Box marginBottom={1} flexShrink={0} flexDirection="column">
                  <Text bold color="cyan">
                    Template Values:
                  </Text>
                  <Box paddingLeft={2}>
                    <Text dimColor>
                      {JSON.stringify(result.input, null, 2)}
                    </Text>
                  </Box>
                </Box>

                {/* Output or Error */}
                {result.error ? (
                  <Box flexShrink={0} flexDirection="column">
                    <Box marginTop={1} flexShrink={0}>
                      <Text bold color="red">
                        Error:
                      </Text>
                    </Box>
                    <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                      <Text color="red">{result.error}</Text>
                    </Box>
                    {result.errorDetails && (
                      <>
                        <Box marginTop={1} flexShrink={0}>
                          <Text bold color="red" dimColor>
                            Error Details:
                          </Text>
                        </Box>
                        <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                          <Text dimColor>
                            {JSON.stringify(result.errorDetails, null, 2)}
                          </Text>
                        </Box>
                      </>
                    )}
                  </Box>
                ) : (
                  <Box flexShrink={0} flexDirection="column">
                    <Text bold color="green">
                      Resource Content:
                    </Text>
                    <Box paddingLeft={2}>
                      <Text dimColor>
                        {JSON.stringify(result.output, null, 2)}
                      </Text>
                    </Box>
                  </Box>
                )}
              </ScrollView>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
