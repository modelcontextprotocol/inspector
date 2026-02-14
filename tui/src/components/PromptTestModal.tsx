import React, { useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { InspectorClient } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import { promptArgsToForm } from "../utils/promptArgsToForm.js";
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

interface PromptTestModalProps {
  prompt: {
    name: string;
    description?: string;
    arguments?: any[];
  };
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  onClose: () => void;
}

type ModalState = "form" | "loading" | "results";

interface PromptResult {
  input: Record<string, string>;
  output: any;
  error?: string;
  errorDetails?: any;
  duration: number;
}

export function PromptTestModal({
  prompt,
  inspectorClient,
  width,
  height,
  onClose,
}: PromptTestModalProps) {
  const [state, setState] = useState<ModalState>("form");
  const [result, setResult] = useState<PromptResult | null>(null);
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

  const formStructure = promptArgsToForm(
    prompt.arguments || [],
    prompt.name || "Unknown Prompt",
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
    if (!inspectorClient || !prompt) return;

    setState("loading");
    const startTime = Date.now();

    try {
      // Get the prompt using the provided arguments
      const invocation = await inspectorClient.getPrompt(prompt.name, values);

      const duration = Date.now() - startTime;

      setResult({
        input: values,
        output: invocation.result,
        duration,
      });
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

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
              {prompt.description && (
                <Box marginBottom={1} flexShrink={0}>
                  <Text dimColor>{prompt.description}</Text>
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
              <Text color="yellow">Getting prompt...</Text>
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

                {/* Input */}
                {Object.keys(result.input).length > 0 && (
                  <Box marginBottom={1} flexShrink={0} flexDirection="column">
                    <Text bold color="cyan">
                      Arguments:
                    </Text>
                    <Box paddingLeft={2}>
                      <Text dimColor>
                        {JSON.stringify(result.input, null, 2)}
                      </Text>
                    </Box>
                  </Box>
                )}

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
                      Prompt Messages:
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
