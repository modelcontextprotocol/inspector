import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  NativeSelect,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IMPORT_STRATEGY_LIST,
  parseMcpServersConfig,
  parseVsCodeConfig,
  planImport,
  uniqueId,
  type ImportSourceResult,
  type ConflictResolution,
} from "@inspector/core/mcp/import/index.js";
import type { MCPConfig, MCPServerConfig } from "@inspector/core/mcp/types.js";

export interface ServerImportConfigModalProps {
  opened: boolean;
  /** Ids already in the catalog — drives conflict detection + rename defaults. */
  existingIds: string[];
  onClose: () => void;
  /** Read a client's well-known config on the backend (authed GET). */
  onFetchSource: (type: string) => Promise<ImportSourceResult>;
  onAddServer: (id: string, config: MCPServerConfig) => Promise<void>;
  onUpdateServer: (
    originalId: string,
    newId: string,
    config: MCPServerConfig,
  ) => Promise<void>;
}

type Phase = "select" | "loading" | "review" | "summary";

interface Resolution {
  action: ConflictResolution;
  renameTo: string;
}

/** Per-row choice for a brand-new (non-conflicting) server. */
type AdditionAction = "import" | "skip";

interface ImportOutcome {
  id: string;
  status: "added" | "overwritten" | "renamed" | "skipped" | "failed";
  detail?: string;
}

const SectionStack = Stack.withProps({ gap: "md" });
const SourceRow = Group.withProps({
  gap: "sm",
  align: "flex-end",
  wrap: "nowrap",
});
const Actions = Group.withProps({ justify: "flex-end", gap: "sm", mt: "md" });
const RowGroup = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
});
const DimText = Text.withProps({ size: "sm", c: "dimmed" });
const ModalTitle = Text.withProps({ fw: 700, span: true });

/**
 * Source-picker dropdown options, derived from the strategy registry. A leading
 * empty option acts as the "nothing selected yet" placeholder (Import stays
 * disabled until a real client is chosen).
 */
const SOURCE_OPTIONS = [
  { value: "", label: "Select a client…" },
  ...IMPORT_STRATEGY_LIST.map((s) => ({ value: s.id, label: s.label })),
];

const RESOLUTION_DATA = [
  { value: "overwrite", label: "Overwrite" },
  { value: "skip", label: "Skip" },
  { value: "rename", label: "Rename" },
];

const ADDITION_DATA = [
  { value: "import", label: "Import" },
  { value: "skip", label: "Skip" },
];

/** Display label + badge color for each per-server import outcome. */
const OUTCOME_META: Record<
  ImportOutcome["status"],
  { label: string; color: string }
> = {
  added: { label: "Imported", color: "green" },
  overwritten: { label: "Overwritten", color: "blue" },
  renamed: { label: "Renamed", color: "blue" },
  skipped: { label: "Skipped", color: "gray" },
  failed: { label: "Failed", color: "red" },
};

/** Try the standard `{ mcpServers }` shape first, then VS Code's `servers`. */
function parseAnyClientConfig(raw: string): MCPConfig {
  try {
    return parseMcpServersConfig(raw);
  } catch (mcpErr) {
    try {
      return parseVsCodeConfig(raw);
    } catch {
      // Surface the primary parser's message — it's the common case.
      throw mcpErr instanceof Error ? mcpErr : new Error(String(mcpErr));
    }
  }
}

/**
 * Source picker + conflict-resolution flow for importing another MCP client's
 * config (#1348). Phase 1 lets the user pick a known client (read on the
 * backend) or upload a file; phase 2 reviews the parsed servers, resolving any
 * id collisions (overwrite / skip / rename) before writing them through the
 * add/update callbacks; phase 3 shows a per-server outcome summary.
 */
export function ServerImportConfigModal({
  opened,
  existingIds,
  onClose,
  onFetchSource,
  onAddServer,
  onUpdateServer,
}: ServerImportConfigModalProps) {
  const [phase, setPhase] = useState<Phase>("select");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [incoming, setIncoming] = useState<MCPConfig | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {},
  );
  const [additionActions, setAdditionActions] = useState<
    Record<string, AdditionAction>
  >({});
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Reset the wizard each time the modal transitions to open. Done during
  // render (React's "adjust state when a prop changes" pattern) rather than in
  // an effect so there's no extra commit/cascade.
  const [prevOpened, setPrevOpened] = useState(opened);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setPhase("select");
      setError(undefined);
      setNotice(undefined);
      setIncoming(null);
      setResolutions({});
      setAdditionActions({});
      setOutcomes([]);
      setSelectedType(null);
    }
  }

  const plan = useMemo(
    () => (incoming ? planImport(incoming, existingIds) : null),
    [incoming, existingIds],
  );

  function beginReview(config: MCPConfig) {
    const entries = Object.keys(config.mcpServers);
    if (entries.length === 0) {
      setError("No servers found in the selected source.");
      setPhase("select");
      return;
    }
    const fresh = planImport(config, existingIds);
    const taken = [...existingIds, ...fresh.additions.map((a) => a.id)];
    const initial: Record<string, Resolution> = {};
    for (const conflict of fresh.conflicts) {
      initial[conflict.id] = {
        action: "skip",
        renameTo: uniqueId(conflict.id, taken),
      };
    }
    // New servers default to "import"; the user can opt individual ones out.
    const initialAdds: Record<string, AdditionAction> = {};
    for (const add of fresh.additions) {
      initialAdds[add.id] = "import";
    }
    setIncoming(config);
    setResolutions(initial);
    setAdditionActions(initialAdds);
    setError(undefined);
    setPhase("review");
  }

  async function handlePickSource(type: string) {
    setPhase("loading");
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await onFetchSource(type);
      if (result.error) {
        setError(result.error);
        setPhase("select");
        return;
      }
      if (!result.found || !result.config) {
        setNotice(
          `No config found. Searched: ${result.searched.join(", ")}. Try uploading a file instead.`,
        );
        setPhase("select");
        return;
      }
      beginReview(result.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("select");
    }
  }

  async function handlePickFile(file: File | null) {
    if (!file) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const raw = await file.text();
      beginReview(parseAnyClientConfig(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setResolution(id: string, action: ConflictResolution) {
    setResolutions((r) => ({ ...r, [id]: { ...r[id], action } }));
  }

  function setRenameTo(id: string, renameTo: string) {
    setResolutions((r) => ({ ...r, [id]: { ...r[id], renameTo } }));
  }

  function setAdditionAction(id: string, action: AdditionAction) {
    setAdditionActions((a) => ({ ...a, [id]: action }));
  }

  async function applyEntry(
    id: string,
    outcome: ImportOutcome["status"],
    write: () => Promise<void>,
  ): Promise<ImportOutcome> {
    try {
      await write();
      return { id, status: outcome };
    } catch (err) {
      return {
        id,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function handleImport() {
    if (!plan) return;
    setPhase("loading");
    const results: ImportOutcome[] = [];
    for (const add of plan.additions) {
      if ((additionActions[add.id] ?? "import") === "skip") {
        results.push({ id: add.id, status: "skipped" });
        continue;
      }
      results.push(
        await applyEntry(add.id, "added", () =>
          Promise.resolve(onAddServer(add.id, add.config)),
        ),
      );
    }
    for (const conflict of plan.conflicts) {
      const res = resolutions[conflict.id] ?? {
        action: "skip",
        renameTo: conflict.id,
      };
      if (res.action === "skip") {
        results.push({ id: conflict.id, status: "skipped" });
      } else if (res.action === "overwrite") {
        results.push(
          await applyEntry(conflict.id, "overwritten", () =>
            onUpdateServer(conflict.id, conflict.id, conflict.config),
          ),
        );
      } else {
        const newId = res.renameTo.trim() || conflict.id;
        results.push(
          await applyEntry(newId, "renamed", () =>
            Promise.resolve(onAddServer(newId, conflict.config)),
          ),
        );
      }
    }
    setOutcomes(results);
    setPhase("summary");
  }

  const importCount = plan
    ? plan.additions.filter(
        (a) => (additionActions[a.id] ?? "import") === "import",
      ).length +
      plan.conflicts.filter(
        (c) => (resolutions[c.id]?.action ?? "skip") !== "skip",
      ).length
    : 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      title={<ModalTitle>Import client config</ModalTitle>}
    >
      <SectionStack>
        {error ? (
          <Alert color="red" title="Import error">
            {error}
          </Alert>
        ) : null}
        {notice ? <Alert color="yellow">{notice}</Alert> : null}

        {phase === "select" ? (
          <SectionStack>
            <DimText>
              Import MCP servers from another client. Choose a known client
              (read on this machine) or upload its config file.
            </DimText>
            <SourceRow>
              <NativeSelect
                label="Client"
                data={SOURCE_OPTIONS}
                value={selectedType ?? ""}
                onChange={(e) => setSelectedType(e.currentTarget.value || null)}
                flex={1}
              />
              <Button
                disabled={!selectedType}
                onClick={() => {
                  if (selectedType) void handlePickSource(selectedType);
                }}
              >
                Import
              </Button>
              <FileButton
                accept="application/json,.json"
                onChange={handlePickFile}
              >
                {(props) => (
                  <Button {...props} variant="default">
                    From file…
                  </Button>
                )}
              </FileButton>
            </SourceRow>
          </SectionStack>
        ) : null}

        {phase === "loading" ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">Working…</Text>
          </Group>
        ) : null}

        {phase === "review" && plan ? (
          <SectionStack>
            {plan.additions.length > 0 ? (
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  New servers ({plan.additions.length})
                </Text>
                {plan.additions.map((a) => (
                  <RowGroup key={a.id}>
                    <Text size="sm">{a.id}</Text>
                    <SegmentedControl
                      size="xs"
                      data={ADDITION_DATA}
                      value={additionActions[a.id] ?? "import"}
                      onChange={(value) =>
                        setAdditionAction(a.id, value as AdditionAction)
                      }
                    />
                  </RowGroup>
                ))}
              </Stack>
            ) : null}

            {plan.conflicts.length > 0 ? (
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  Already exists ({plan.conflicts.length})
                </Text>
                {plan.conflicts.map((conflict) => {
                  const res = resolutions[conflict.id];
                  return (
                    <Stack key={conflict.id} gap="xs">
                      <RowGroup>
                        <Text size="sm">{conflict.id}</Text>
                        <SegmentedControl
                          size="xs"
                          data={RESOLUTION_DATA}
                          value={res?.action ?? "skip"}
                          onChange={(value) =>
                            setResolution(
                              conflict.id,
                              value as ConflictResolution,
                            )
                          }
                        />
                      </RowGroup>
                      {res?.action === "rename" ? (
                        <TextInput
                          size="xs"
                          aria-label={`New id for ${conflict.id}`}
                          value={res.renameTo}
                          onChange={(e) =>
                            setRenameTo(conflict.id, e.currentTarget.value)
                          }
                        />
                      ) : null}
                    </Stack>
                  );
                })}
              </Stack>
            ) : null}

            <Actions>
              <Button variant="default" onClick={() => setPhase("select")}>
                Back
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={importCount === 0}
              >
                Import {importCount} server{importCount === 1 ? "" : "s"}
              </Button>
            </Actions>
          </SectionStack>
        ) : null}

        {phase === "summary" ? (
          <SectionStack>
            <Text fw={600} size="sm">
              Import complete
            </Text>
            {outcomes.map((o) => {
              const meta = OUTCOME_META[o.status];
              return (
                <Stack key={`${o.id}-${o.status}`} gap={2}>
                  <RowGroup>
                    <Text size="sm">{o.id}</Text>
                    <Badge color={meta.color} variant="light">
                      {meta.label}
                    </Badge>
                  </RowGroup>
                  {o.detail ? (
                    <Text size="xs" c="var(--inspector-status-error)">
                      {o.detail}
                    </Text>
                  ) : null}
                </Stack>
              );
            })}
            <Actions>
              <Button onClick={onClose}>Done</Button>
            </Actions>
          </SectionStack>
        ) : null}
      </SectionStack>
    </Modal>
  );
}
