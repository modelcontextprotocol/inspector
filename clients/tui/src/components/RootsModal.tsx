/**
 * Roots editor (#2432): list, add and remove the roots this client advertises
 * to the selected server.
 *
 * A modal rather than a tab because adding a root needs free-text input, and
 * only a modal suppresses App's global accelerators (a typed `r` would
 * otherwise jump to Resources). It is opened from the Info tab with `e`.
 *
 * Every change goes through `InspectorClient.setRoots`, which normalizes the
 * list with `cleanRoots` and sends `notifications/roots/list_changed`, so the
 * server re-requests `roots/list` — the same path the web client's settings
 * save takes. The change is for this session only: the TUI does not write
 * `mcp.json`, so the configured roots return on the next launch.
 */
import React, { useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form, type FormStructure } from "ink-form";
import type { Root } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { useSelectableList } from "../hooks/useSelectableList.js";
import { errorMessage } from "../utils/errorText.js";

export const ADD_ROOT_FORM: FormStructure = {
  title: "Add Root",
  sections: [
    {
      title: "Root",
      fields: [
        {
          name: "uri",
          label: "URI (e.g. file:///path)",
          type: "string",
          required: true,
        },
        { name: "name", label: "Name (optional)", type: "string" },
      ],
    },
  ],
};

/** Build the root a submitted form describes, or explain why it can't. */
export function rootFromForm(
  values: Record<string, unknown>,
): Root | { error: string } {
  const uri = typeof values.uri === "string" ? values.uri.trim() : "";
  if (!uri) return { error: "A root needs a URI" };
  const name = typeof values.name === "string" ? values.name.trim() : "";
  return name ? { uri, name } : { uri };
}

interface RootsModalProps {
  roots: Root[];
  inspectorClient: InspectorClient | null;
  connected: boolean;
  width: number;
  height: number;
  onClose: () => void;
}

export function RootsModal({
  roots,
  inspectorClient,
  connected,
  width,
  height,
  onClose,
}: RootsModalProps) {
  const [mode, setMode] = useState<"list" | "add">("list");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const modalWidth = width - 2;
  const modalHeight = height - 2;
  const visibleCount = Math.max(1, modalHeight - 8);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    roots.length,
    visibleCount,
  );

  // `saving` drives the status line; this ref is the guard, because two keys
  // can land before React re-renders and both would save from the same stale
  // `roots`, announcing roots/list_changed twice for one edit.
  const savingRef = useRef(false);

  const save = async (next: Root[]) => {
    if (!inspectorClient || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await inspectorClient.setRoots(next);
      setMode("list");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = (values: Record<string, unknown>) => {
    const root = rootFromForm(values);
    if ("error" in root) {
      setError(root.error);
      setMode("list");
      return;
    }
    // `save` owns every rejection (its catch surfaces the message).
    void save([...roots, root]);
  };

  useInput((input: string, key: Key) => {
    if (key.escape) {
      // Esc backs out of the form first, and closes the editor from the list.
      if (mode === "add") {
        setMode("list");
      } else {
        onClose();
      }
      return;
    }
    // The form owns every other key while it is open.
    if (mode === "add" || saving) return;

    if (key.upArrow && selectedIndex > 0) {
      setSelection(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < roots.length - 1) {
      setSelection(selectedIndex + 1);
    } else if (input === "n" || input === "+") {
      if (!connected) {
        setError("Connect to the server to change its roots");
        return;
      }
      setError(null);
      setMode("add");
    } else if ((input === "x" || key.delete) && roots[selectedIndex]) {
      if (!connected) {
        setError("Connect to the server to change its roots");
        return;
      }
      void save(roots.filter((_, i) => i !== selectedIndex));
    }
  });

  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
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
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            Roots ({roots.length})
          </Text>
          <Text> </Text>
          <Text dimColor>
            {mode === "add" ? "(ESC to go back)" : "(ESC to close)"}
          </Text>
        </Box>

        {mode === "add" ? (
          <Box flexGrow={1} flexDirection="column">
            <Form
              form={ADD_ROOT_FORM}
              onSubmit={(values: object) =>
                handleSubmit(values as Record<string, unknown>)
              }
            />
          </Box>
        ) : (
          <Box flexGrow={1} flexDirection="column" overflow="hidden">
            {roots.length === 0 ? (
              <Text dimColor>No roots are advertised to this server</Text>
            ) : (
              roots
                .slice(firstVisible, firstVisible + visibleCount)
                .map((root, i) => {
                  const index = firstVisible + i;
                  return (
                    <Box key={`${root.uri}-${index}`} flexShrink={0}>
                      <Text wrap="truncate">
                        {index === selectedIndex ? "▶ " : "  "}
                        {root.uri}
                        {root.name && <Text dimColor> ({root.name})</Text>}
                      </Text>
                    </Box>
                  );
                })
            )}
          </Box>
        )}

        {saving && (
          <Box flexShrink={0}>
            <Text color="yellow">Updating roots…</Text>
          </Box>
        )}
        {error && (
          <Box flexShrink={0}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        {!connected && (
          <Box flexShrink={0}>
            <Text dimColor>
              Read-only while disconnected — connect to edit.
            </Text>
          </Box>
        )}
        {mode === "list" && (
          <Box
            flexShrink={0}
            height={1}
            justifyContent="center"
            backgroundColor="gray"
          >
            <Text bold color="white" wrap="truncate">
              n to add, x to remove, ↑/↓ to select. Changes last this session.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
