import React, { useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/client";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import {
  decodeFormValues,
  missingRequiredFields,
  schemaToForm,
} from "../utils/schemaToForm.js";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { inlineLocalRefs } from "@inspector/core/json/localRefs.js";
import { redactErrorText, redactedJson } from "../utils/errorText.js";
import type { ResultFileFormat } from "@inspector/core/mcp/resultFile.js";
import {
  defaultResultFileName,
  saveResultToFile,
} from "../utils/saveResult.js";
import {
  SaveResultBar,
  type SavePrompt,
  type SaveStatus,
} from "./SaveResultBar.js";

interface ToolTestModalProps {
  tool: Tool;
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  onClose: () => void;
  onAuthRecoveryRequired?: (error: AuthRecoveryRequiredError) => void;
}

type ModalState = "form" | "loading" | "results";

interface ToolResult {
  input: Record<string, JsonValue>;
  output: CallToolResult | null;
  error?: string;
  errorDetails?: unknown;
  duration: number;
  /**
   * The server's own `CallToolResult`, whether it succeeded or carried
   * `isError` — what `w` saves. Absent when no result came back at all (a
   * thrown call, a failed invocation, a missing-argument refusal).
   */
  callResult?: CallToolResult;
}

export function ToolTestModal({
  tool,
  inspectorClient,
  width,
  height,
  onClose,
  onAuthRecoveryRequired,
}: ToolTestModalProps) {
  const [state, setState] = useState<ModalState>("form");
  const [result, setResult] = useState<ToolResult | null>(null);
  const [savePrompt, setSavePromptState] = useState<SavePrompt | null>(null);
  // The prompt as of the last keystroke, not the last render. Ink keeps the
  // previous render's input handler attached until effects flush, so a key
  // typed right after `w` (or a second key in the same burst) would otherwise
  // see a stale `savePrompt` — Enter dropped, or two Backspaces deleting one
  // character. Every update goes through `setSavePrompt` so the two agree.
  const savePromptRef = React.useRef<SavePrompt | null>(null);
  const setSavePrompt = (next: SavePrompt | null) => {
    savePromptRef.current = next;
    setSavePromptState(next);
  };
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const scrollViewRef = React.useRef<ScrollViewRef>(null);
  // Numbers this view's saves so only the latest may report. The queue in
  // saveResultToFile keeps the writes themselves ordered; this keeps an older
  // save settling from replacing the newer one's "Saving…" with its "Saved".
  const saveAttemptRef = React.useRef(0);
  const toolName = tool?.name || "tool";

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

  // Same-document `$ref`s inlined once, for the form and the decode alike: a
  // property declared as a bare `$ref` has no `type` to build a field from, so
  // a deduplicated Zod schema would otherwise lose its string input (#2321).
  const inputSchema = inlineLocalRefs(tool?.inputSchema);

  const formStructure = inputSchema
    ? schemaToForm(inputSchema, tool?.name || "Unknown Tool")
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
  // Ink attaches useInput's handler in an effect, so until effects flush a key
  // still reaches the previous render's handler. Routing every key through a
  // ref read at call time means it always sees the latest render's state.
  const handleInputRef = React.useRef<(input: string, key: Key) => void>(
    () => {},
  );
  handleInputRef.current = (input: string, key: Key) => {
    // While the save prompt is open it owns every key, Escape included —
    // Escape cancels the prompt rather than closing the whole modal.
    const prompt = savePromptRef.current;
    if (prompt) {
      handleSavePromptInput(prompt, input, key);
      return;
    }

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
      // Plain w only: Ink reports a chord's letter in `input` too.
      if (input === "w" && !key.ctrl && !key.meta) {
        openSavePrompt();
        return;
      }
      // Allow scrolling in results view
      if (key.downArrow) {
        scrollViewRef.current?.scrollBy(1);
      } else if (key.upArrow) {
        scrollViewRef.current?.scrollBy(-1);
      } else if (key.pageDown) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(viewportHeight);
      } else if (key.pageUp) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(-viewportHeight);
      }
    }
  };
  useInput((input: string, key: Key) => handleInputRef.current(input, key), {
    isActive: true,
  });

  const openSavePrompt = () => {
    if (!result?.callResult) {
      setSaveStatus({
        ok: false,
        message:
          "No tool result to save — no result came back from the server.",
      });
      return;
    }
    setSaveStatus(null);
    setSavePrompt({
      path: defaultResultFileName(toolName, "json", result.callResult),
      format: "json",
      edited: false,
    });
  };

  const handleSavePromptInput = (
    prompt: SavePrompt,
    input: string,
    key: Key,
  ) => {
    if (key.escape) {
      setSavePrompt(null);
      return;
    }
    if (key.return) {
      setSavePrompt(null);
      // A key handler cannot await; saveCurrentResult owns its failures and
      // surfaces them on the status line.
      void saveCurrentResult(prompt);
      return;
    }
    if (key.tab) {
      const format: ResultFileFormat =
        prompt.format === "json" ? "raw" : "json";
      setSavePrompt({
        ...prompt,
        format,
        path: prompt.edited
          ? prompt.path
          : defaultResultFileName(toolName, format, result?.callResult),
      });
      return;
    }
    if (key.backspace || key.delete) {
      setSavePrompt({
        ...prompt,
        path: prompt.path.slice(0, -1),
        edited: true,
      });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setSavePrompt({ ...prompt, path: prompt.path + input, edited: true });
    }
  };

  const saveCurrentResult = async (prompt: SavePrompt) => {
    const attempt = ++saveAttemptRef.current;
    const report = (status: SaveStatus) => {
      if (attempt === saveAttemptRef.current) setSaveStatus(status);
    };
    setSaveStatus({ ok: true, message: `Saving to ${prompt.path}…` });
    try {
      const saved = await saveResultToFile(
        result?.callResult,
        prompt.path,
        prompt.format,
      );
      report({
        ok: true,
        message: `Saved ${saved.format} result to ${saved.path} (${saved.bytes} ${saved.bytes === 1 ? "byte" : "bytes"})`,
      });
    } catch (err) {
      report({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleFormSubmit = async (rawValues: Record<string, JsonValue>) => {
    if (!inspectorClient || !tool) return;

    // A root union renders every alternative as its own section, under prefixed
    // field names, because ink-form scopes values by name across the whole form
    // (#2123). This turns them back into the arguments the server declared:
    // the base fields plus the chosen branch's, and nothing from the others.
    const values = decodeFormValues(inputSchema, rawValues);

    // A branch's fields are rendered optional — only one alternative applies to
    // a call, and requiring every branch's would deadlock a static form — so
    // the chosen shape's own requirements are checked here instead. Reported
    // rather than sent: a call known to violate the schema teaches the user
    // nothing about the server (#2123).
    const missing = missingRequiredFields(inputSchema, values, rawValues);
    if (missing.length > 0) {
      setResult({
        input: values,
        output: null,
        error: `Missing required argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        duration: 0,
      });
      setState("results");
      return;
    }

    setState("loading");
    const startTime = Date.now();

    try {
      // Use InspectorClient.callTool() which handles parameter conversion and metadata
      const invocation = await inspectorClient.callTool(tool, values);

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

        setResult({
          input: values,
          output: isError ? null : result,
          error: isError ? "Tool returned an error" : undefined,
          errorDetails: isError ? result : undefined,
          duration,
          callResult: result,
        });
      }
      setState("results");
    } catch (error) {
      if (error instanceof AuthRecoveryRequiredError) {
        onAuthRecoveryRequired?.(error);
        onClose();
        return;
      }
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
        backgroundColor="black"
      >
        {/* Header */}
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            {formStructure.title}
          </Text>
          <Text> </Text>
          <Text dimColor>
            {state === "results" && result?.callResult
              ? "(w to save result, ESC to close)"
              : "(Press ESC to close)"}
          </Text>
        </Box>

        {/* Content Area */}
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {state === "form" && (
            <Box flexGrow={1} width="100%">
              <Form
                form={formStructure}
                onSubmit={(value: object) =>
                  void handleFormSubmit(value as Record<string, JsonValue>)
                }
              />
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
                      <Text color="red">
                        {redactErrorText(String(result.error))}
                      </Text>
                    </Box>
                    {result.errorDetails != null ? (
                      <>
                        <Box marginTop={1}>
                          <Text bold color="red" dimColor>
                            Error Details:
                          </Text>
                        </Box>
                        <Box paddingLeft={2}>
                          <Text dimColor>
                            {redactedJson(result.errorDetails)}
                          </Text>
                        </Box>
                      </>
                    ) : null}
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

          <SaveResultBar prompt={savePrompt} status={saveStatus} />
        </Box>
      </Box>
    </Box>
  );
}
