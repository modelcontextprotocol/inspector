import {
  jsx as _jsx,
  jsxs as _jsxs,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Form } from "ink-form";
import { schemaToForm } from "../utils/schemaToForm.js";
import { ScrollView } from "ink-scroll-view";
export function ToolTestModal({ tool, client, width, height, onClose }) {
  const [state, setState] = useState("form");
  const [result, setResult] = useState(null);
  const scrollViewRef = React.useRef(null);
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
    (input, key) => {
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
  const handleFormSubmit = async (values) => {
    if (!client || !tool) return;
    setState("loading");
    const startTime = Date.now();
    try {
      const response = await client.callTool({
        name: tool.name,
        arguments: values,
      });
      const duration = Date.now() - startTime;
      // Handle MCP SDK response format
      const output = response.isError
        ? { error: true, content: response.content }
        : response.structuredContent || response.content || response;
      setResult({
        input: values,
        output: response.isError ? null : output,
        error: response.isError ? "Tool returned an error" : undefined,
        errorDetails: response.isError ? output : undefined,
        duration,
      });
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
  return _jsx(Box, {
    position: "absolute",
    width: terminalDimensions.width,
    height: terminalDimensions.height,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    children: _jsxs(Box, {
      width: modalWidth,
      height: modalHeight,
      borderStyle: "single",
      borderColor: "cyan",
      flexDirection: "column",
      paddingX: 1,
      paddingY: 1,
      backgroundColor: "black",
      children: [
        _jsxs(Box, {
          flexShrink: 0,
          marginBottom: 1,
          children: [
            _jsx(Text, {
              bold: true,
              color: "cyan",
              children: formStructure.title,
            }),
            _jsx(Text, { children: " " }),
            _jsx(Text, { dimColor: true, children: "(Press ESC to close)" }),
          ],
        }),
        _jsxs(Box, {
          flexGrow: 1,
          flexDirection: "column",
          overflow: "hidden",
          children: [
            state === "form" &&
              _jsx(Box, {
                flexGrow: 1,
                width: "100%",
                children: _jsx(Form, {
                  form: formStructure,
                  onSubmit: handleFormSubmit,
                }),
              }),
            state === "loading" &&
              _jsx(Box, {
                flexGrow: 1,
                justifyContent: "center",
                alignItems: "center",
                children: _jsx(Text, {
                  color: "yellow",
                  children: "Calling tool...",
                }),
              }),
            state === "results" &&
              result &&
              _jsx(Box, {
                flexGrow: 1,
                flexDirection: "column",
                overflow: "hidden",
                children: _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  children: [
                    _jsx(Box, {
                      marginBottom: 1,
                      flexShrink: 0,
                      children: _jsxs(Text, {
                        bold: true,
                        color: "green",
                        children: ["Duration: ", result.duration, "ms"],
                      }),
                    }),
                    _jsxs(Box, {
                      marginBottom: 1,
                      flexShrink: 0,
                      flexDirection: "column",
                      children: [
                        _jsx(Text, {
                          bold: true,
                          color: "cyan",
                          children: "Input:",
                        }),
                        _jsx(Box, {
                          paddingLeft: 2,
                          children: _jsx(Text, {
                            dimColor: true,
                            children: JSON.stringify(result.input, null, 2),
                          }),
                        }),
                      ],
                    }),
                    result.error
                      ? _jsxs(Box, {
                          flexShrink: 0,
                          flexDirection: "column",
                          children: [
                            _jsx(Text, {
                              bold: true,
                              color: "red",
                              children: "Error:",
                            }),
                            _jsx(Box, {
                              paddingLeft: 2,
                              children: _jsx(Text, {
                                color: "red",
                                children: result.error,
                              }),
                            }),
                            result.errorDetails &&
                              _jsxs(_Fragment, {
                                children: [
                                  _jsx(Box, {
                                    marginTop: 1,
                                    children: _jsx(Text, {
                                      bold: true,
                                      color: "red",
                                      dimColor: true,
                                      children: "Error Details:",
                                    }),
                                  }),
                                  _jsx(Box, {
                                    paddingLeft: 2,
                                    children: _jsx(Text, {
                                      dimColor: true,
                                      children: JSON.stringify(
                                        result.errorDetails,
                                        null,
                                        2,
                                      ),
                                    }),
                                  }),
                                ],
                              }),
                          ],
                        })
                      : _jsxs(Box, {
                          flexShrink: 0,
                          flexDirection: "column",
                          children: [
                            _jsx(Text, {
                              bold: true,
                              color: "green",
                              children: "Output:",
                            }),
                            _jsx(Box, {
                              paddingLeft: 2,
                              children: _jsx(Text, {
                                dimColor: true,
                                children: JSON.stringify(
                                  result.output,
                                  null,
                                  2,
                                ),
                              }),
                            }),
                          ],
                        }),
                  ],
                }),
              }),
          ],
        }),
      ],
    }),
  });
}
