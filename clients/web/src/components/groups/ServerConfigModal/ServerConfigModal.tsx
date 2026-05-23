import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import type {
  MCPServerConfig,
  SseServerConfig,
  StdioServerConfig,
  StreamableHttpServerConfig,
} from "@inspector/core/mcp/types.js";

/** Allowed id pattern — mirrors validateStoreId in core/storage/store-io.ts */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type ServerConfigModalMode = "add" | "edit" | "clone";

export interface ServerConfigModalProps {
  opened: boolean;
  mode: ServerConfigModalMode;
  /** When editing, the existing id of the target server. */
  initialId?: string;
  /** When editing or cloning, the existing config to pre-populate. */
  initialConfig?: MCPServerConfig;
  /** Ids already in use — drives the uniqueness check (caller excludes the
   *  target id from this list when in 'edit' mode). */
  existingIds: string[];
  onClose: () => void;
  onSubmit: (id: string, config: MCPServerConfig) => Promise<void> | void;
}

type TransportChoice = "stdio" | "sse" | "streamable-http";

interface FormState {
  id: string;
  transport: TransportChoice;
  // stdio
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  // sse / streamable-http
  url: string;
  headersText: string;
}

const SectionStack = Stack.withProps({ gap: "md" });
const FieldGrid = Stack.withProps({ gap: "sm" });
const Actions = Group.withProps({ justify: "flex-end", gap: "sm", mt: "md" });

const MODE_TITLES: Record<ServerConfigModalMode, string> = {
  add: "Add server",
  edit: "Edit server",
  clone: "Clone server",
};

function configToFormState(
  initialId: string | undefined,
  initialConfig: MCPServerConfig | undefined,
  mode: ServerConfigModalMode,
): FormState {
  const id = mode === "edit" ? (initialId ?? "") : "";
  const transport: TransportChoice =
    initialConfig?.type === undefined ? "stdio" : initialConfig.type;
  if (!initialConfig) {
    return {
      id,
      transport: "stdio",
      command: "",
      argsText: "",
      envText: "",
      cwd: "",
      url: "",
      headersText: "",
    };
  }
  if (transport === "stdio") {
    const c = initialConfig as StdioServerConfig;
    return {
      id,
      transport,
      command: c.command ?? "",
      argsText: (c.args ?? []).join("\n"),
      envText: Object.entries(c.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
      cwd: c.cwd ?? "",
      url: "",
      headersText: "",
    };
  }
  // sse / streamable-http
  const c = initialConfig as SseServerConfig | StreamableHttpServerConfig;
  return {
    id,
    transport,
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: c.url ?? "",
    headersText: Object.entries(c.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  };
}

function parseArgs(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEnv(raw: string):
  | {
      ok: true;
      value: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    } {
  const out: Record<string, string> = {};
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return { ok: false, error: `Invalid env line "${line}". Use KEY=VALUE.` };
    }
    const key = line.slice(0, eq).trim();
    // env values preserve trailing whitespace — they're shell-style strings
    // where spaces / tabs can be load-bearing; header values are HTTP-style
    // and parseHeaders below trims them per RFC 7230 §3.2.4.
    const value = line.slice(eq + 1);
    if (!key)
      return { ok: false, error: `Invalid env line "${line}". Empty key.` };
    out[key] = value;
  }
  return { ok: true, value: out };
}

function parseHeaders(raw: string):
  | {
      ok: true;
      value: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    } {
  const out: Record<string, string> = {};
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      return {
        ok: false,
        error: `Invalid header line "${line}". Use "Header-Name: value".`,
      };
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) {
      return { ok: false, error: `Invalid header line "${line}". Empty name.` };
    }
    out[key] = value;
  }
  return { ok: true, value: out };
}

export function ServerConfigModal({
  opened,
  mode,
  initialId,
  initialConfig,
  existingIds,
  onClose,
  onSubmit,
}: ServerConfigModalProps) {
  const initial = useMemo(
    () => configToFormState(initialId, initialConfig, mode),
    [initialId, initialConfig, mode],
  );
  const [form, setForm] = useState<FormState>(initial);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset form whenever the modal opens with new inputs.
  useEffect(() => {
    if (opened) {
      setForm(initial);
      setSubmitError(undefined);
      setSubmitting(false);
    }
  }, [opened, initial]);

  const trimmedId = form.id.trim();
  const idIsValid = ID_PATTERN.test(trimmedId);
  const idIsDuplicate = trimmedId.length > 0 && existingIds.includes(trimmedId);
  const idError = !trimmedId
    ? undefined
    : !idIsValid
      ? "Use only letters, numbers, hyphens, and underscores."
      : idIsDuplicate
        ? "A server with this id already exists."
        : undefined;

  function buildConfig():
    | {
        ok: true;
        config: MCPServerConfig;
      }
    | {
        ok: false;
        error: string;
      } {
    if (form.transport === "stdio") {
      if (!form.command.trim()) {
        return { ok: false, error: "Command is required for stdio." };
      }
      const env = parseEnv(form.envText);
      if (!env.ok) return env;
      const config: StdioServerConfig = {
        type: "stdio",
        command: form.command.trim(),
      };
      const args = parseArgs(form.argsText);
      if (args.length > 0) config.args = args;
      if (Object.keys(env.value).length > 0) config.env = env.value;
      const cwd = form.cwd.trim();
      if (cwd) config.cwd = cwd;
      return { ok: true, config };
    }
    if (!form.url.trim()) {
      return { ok: false, error: "URL is required for sse / streamable-http." };
    }
    const headers = parseHeaders(form.headersText);
    if (!headers.ok) return headers;
    const base = { url: form.url.trim() };
    const config: SseServerConfig | StreamableHttpServerConfig =
      form.transport === "sse"
        ? { type: "sse", ...base }
        : { type: "streamable-http", ...base };
    if (Object.keys(headers.value).length > 0) config.headers = headers.value;
    return { ok: true, config };
  }

  async function handleSubmit() {
    setSubmitError(undefined);
    if (!trimmedId) {
      setSubmitError("Server id is required.");
      return;
    }
    if (idError) {
      setSubmitError(idError);
      return;
    }
    const built = buildConfig();
    if (!built.ok) {
      setSubmitError(built.error);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmedId, built.config);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const isStdio = form.transport === "stdio";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      title={MODE_TITLES[mode]}
    >
      <SectionStack>
        <FieldGrid>
          <TextInput
            label="Server ID"
            description="Used as the key in mcp.json. Letters, numbers, hyphens, underscores."
            placeholder="my-server"
            value={form.id}
            onChange={(e) =>
              setForm((f) => ({ ...f, id: e.currentTarget.value }))
            }
            error={idError}
            data-autofocus
            required
            disabled={submitting}
          />

          <Select
            label="Transport"
            data={[
              { value: "stdio", label: "stdio (local process)" },
              { value: "sse", label: "sse (Server-Sent Events)" },
              { value: "streamable-http", label: "streamable-http" },
            ]}
            value={form.transport}
            onChange={(value) =>
              setForm((f) => ({
                ...f,
                transport: (value ?? "stdio") as TransportChoice,
              }))
            }
            allowDeselect={false}
            disabled={submitting}
          />

          {isStdio ? (
            <>
              <TextInput
                label="Command"
                placeholder="npx"
                value={form.command}
                onChange={(e) =>
                  setForm((f) => ({ ...f, command: e.currentTarget.value }))
                }
                required
                disabled={submitting}
              />
              <Textarea
                label="Arguments"
                description="One argument per line."
                placeholder={"-y\n@modelcontextprotocol/server-everything"}
                value={form.argsText}
                onChange={(e) =>
                  setForm((f) => ({ ...f, argsText: e.currentTarget.value }))
                }
                autosize
                minRows={3}
                disabled={submitting}
              />
              <Textarea
                label="Environment"
                description="KEY=VALUE per line."
                placeholder="DEBUG=1"
                value={form.envText}
                onChange={(e) =>
                  setForm((f) => ({ ...f, envText: e.currentTarget.value }))
                }
                autosize
                minRows={2}
                disabled={submitting}
              />
              <TextInput
                label="Working directory"
                placeholder="(inherit)"
                value={form.cwd}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cwd: e.currentTarget.value }))
                }
                disabled={submitting}
              />
            </>
          ) : (
            <>
              <TextInput
                label="URL"
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.currentTarget.value }))
                }
                required
                disabled={submitting}
              />
              <Textarea
                label="Headers"
                description='"Header-Name: value" per line.'
                placeholder="Authorization: Bearer xxxxx"
                value={form.headersText}
                onChange={(e) =>
                  setForm((f) => ({ ...f, headersText: e.currentTarget.value }))
                }
                autosize
                minRows={2}
                disabled={submitting}
              />
            </>
          )}
        </FieldGrid>

        {submitError ? (
          <Text c="red" size="sm" role="alert">
            {submitError}
          </Text>
        ) : null}

        <Actions>
          <Button variant="default" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            loading={submitting}
          >
            {mode === "edit" ? "Save" : "Add"}
          </Button>
        </Actions>
      </SectionStack>
    </Modal>
  );
}
