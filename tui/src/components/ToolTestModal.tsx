import React, { useState, useEffect } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { schemaToForm } from "../utils/schemaToForm.js";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";

interface ToolTestModalProps {
  tool: any;
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  onClose: () => void;
}

type ModalState = "form" | "loading" | "results";

interface ToolResult {
  input: any;
  output: any;
  error?: string;
  errorDetails?: any;
  duration: number;
}

export function ToolTestModal({
  tool,
  inspectorClient,
  width,
  height,
  onClose,
}: ToolTestModalProps) {
  const [state, setState] = useState<ModalState>("form");
  const [result, setResult] = useState<ToolResult | null>(null);
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

  const formStructure = tool?.inputSchema
    ? schemaToForm(tool.inputSchema, tool.name || "Unknown Tool")
    : {
        title: `Test Tool: ${tool?.name || "Unknown"}`,
        sections: [{ title: "Parameters", fields: [] }],
      };

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

  const handleFormSubmit = async (values: Record<string, any>) => {
    if (!inspectorClient || !tool) return;

    setState("loading");
    const startTime = Date.now();

    try {
      // Use InspectorClient.callTool() which handles parameter conversion and metadata
      const invocation = await inspectorClient.callTool(tool.name, values);

      const duration = Date.now() - startTime;

      // InspectorClient.callTool() returns ToolCallInvocation
      // Check if the call succeeded and extract the result
      if (!invocation.success || invocation.result === null) {
        // Error case: tool call failed
        setResult({
          input: values,
          output: null,
          error: invocation.error || "Tool call failed",
          errorDetails: invocation,
          duration,
        });
      } else {
        // Success case: extract the result
        const result = invocation.result;
        // Check for error indicators in the result (SDK may return error in result)
        const isError = "isError" in result && result.isError === true;
        const output = isError
          ? { error: true, content: result.content }
          : result.structuredContent || result.content || result;

        setResult({
          input: values,
          output: isError ? null : output,
          error: isError ? "Tool returned an error" : undefined,
          errorDetails: isError ? output : undefined,
          duration,
        });
      }
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorObj =
        error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { error: String(error) };

      setResult({
        input: values,
        output: null,
        error: error instanceof Error ? error.message : "Unknown error",
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
            <Box flexGrow={1} width="100%">
              <Form form={formStructure} onSubmit={handleFormSubmit} />
            </Box>
          )}

          {state === "loading" && (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <Text color="yellow">Calling tool...</Text>
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
                <Box marginBottom={1} flexShrink={0} flexDirection="column">
                  <Text bold color="cyan">
                    Input:
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
                    <Text bold color="red">
                      Error:
                    </Text>
                    <Box paddingLeft={2}>
                      <Text color="red">{result.error}</Text>
                    </Box>
                    {result.errorDetails && (
                      <>
                        <Box marginTop={1}>
                          <Text bold color="red" dimColor>
                            Error Details:
                          </Text>
                        </Box>
                        <Box paddingLeft={2}>
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
                      Output:
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
