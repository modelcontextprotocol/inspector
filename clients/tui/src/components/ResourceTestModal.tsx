import React, { useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import type { ReadResourceResult } from "@modelcontextprotocol/client";
import { uriTemplateToForm } from "../utils/uriTemplateToForm.js";
import {
  definedValues,
  requiredGroups,
  unmetRequiredGroups,
} from "@inspector/core/mcp/uriTemplate.js";
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
  onAuthRecoveryRequired?: (error: AuthRecoveryRequiredError) => void;
}

type ModalState = "form" | "loading" | "results";

interface ResourceResult {
  input: Record<string, string>;
  output: ReadResourceResult | null;
  error?: string;
  errorDetails?: unknown;
  duration: number;
  uri: string;
}

export function ResourceTestModal({
  template,
  inspectorClient,
  width,
  height,
  onClose,
  onAuthRecoveryRequired,
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

    // RFC 6570 keeps a required expression satisfied by any ONE of its names,
    // so `{a,b}` cannot be expressed with ink-form's per-field `required` flag
    // and its members are left optional there. Without this check the TUI would
    // submit `{a,b}` completely blank -- dropping the expression and reading a
    // different resource -- while the web panel blocks the same request (#1919).
    // The message and the gate come from the SAME pass. Filtering the groups
    // again here with a bare `values[name]` disagreed with the gate for a
    // variable named `constructor` or `toString`: the inherited member read as
    // filled, so the list came out empty and the error named no field at all.
    const unmetGroups = unmetRequiredGroups(
      requiredGroups(template.uriTemplate),
      values,
    );
    if (unmetGroups.length > 0) {
      const unmet = unmetGroups.map((names) => names.join(" or "));
      setResult({
        input: values,
        output: null,
        error: `Missing required template variable(s): ${unmet.join(", ")}`,
        duration: 0,
        uri: template.uriTemplate,
      });
      setState("results");
      return;
    }

    setState("loading");
    const startTime = Date.now();

    try {
      // Use InspectorClient's readResourceFromTemplate method which encapsulates template expansion and resource reading
      // Blanks are dropped HERE, not in the expander: a key present with `""`
      // is a defined RFC 6570 value that legitimately expands to `?topic=`,
      // but ink-form hands back `""` for every field the user never touched,
      // so this form cannot tell the two apart. The web panel does the same at
      // its own boundary.
      const invocation = await inspectorClient.readResourceFromTemplate(
        template.uriTemplate,
        definedValues(values),
      );

      const duration = Date.now() - startTime;

      setResult({
        input: values,
        output: invocation.result, // Extract the SDK result from the invocation
        duration,
        uri: invocation.expandedUri, // Use expandedUri instead of uri
      });
      setState("results");
    } catch (error) {
      if (error instanceof AuthRecoveryRequiredError) {
        onAuthRecoveryRequired?.(error);
        onClose();
        return;
      }
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      // Try to get expanded URI from error if available, otherwise use template
      let uri = template.uriTemplate;
      // If the error response contains uri, use it
      if (error && typeof error === "object" && "uri" in error) {
        uri = (error as { uri: string }).uri;
      }

      // Extract detailed error information
      const errorObj: Record<string, unknown> = {
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
                      <Text color="red">{String(result.error)}</Text>
                    </Box>
                    {result.errorDetails != null ? (
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
                    ) : null}
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
