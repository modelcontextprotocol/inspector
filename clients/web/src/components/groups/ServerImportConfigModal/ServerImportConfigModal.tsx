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
  type ConflictResolution,
  type ImportSourceResult,
} from "@inspector/core/mcp/import/index.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import {
  useImportClientConfig,
  type AdditionAction,
  type ImportOutcome,
} from "../../../hooks/useImportClientConfig";

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

/**
 * Display shell for the "Import client config" flow (#1348): a source picker /
 * file upload, a per-server review with conflict resolution, and an outcome
 * summary. All orchestration lives in `useImportClientConfig`.
 */
export function ServerImportConfigModal({
  opened,
  existingIds,
  onClose,
  onFetchSource,
  onAddServer,
  onUpdateServer,
}: ServerImportConfigModalProps) {
  const vm = useImportClientConfig({
    opened,
    existingIds,
    onFetchSource,
    onAddServer,
    onUpdateServer,
  });
  const { plan } = vm;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      title={<ModalTitle>Import client config</ModalTitle>}
    >
      <SectionStack>
        {vm.error ? (
          <Alert color="red" title="Import error">
            {vm.error}
          </Alert>
        ) : null}
        {vm.notice ? <Alert color="yellow">{vm.notice}</Alert> : null}

        {vm.phase === "select" ? (
          <SectionStack>
            <DimText>
              Import MCP servers from another client. Choose a known client
              (read on this machine) or upload its config file.
            </DimText>
            <SourceRow>
              <NativeSelect
                label="Client"
                data={SOURCE_OPTIONS}
                value={vm.selectedType ?? ""}
                onChange={(e) =>
                  vm.setSelectedType(e.currentTarget.value || null)
                }
                flex={1}
              />
              <Button
                disabled={!vm.selectedType}
                onClick={() => {
                  if (vm.selectedType) void vm.pickSource(vm.selectedType);
                }}
              >
                Import
              </Button>
              <FileButton
                accept="application/json,.json"
                onChange={(file) => void vm.pickFile(file)}
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

        {vm.phase === "loading" ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm">Working…</Text>
          </Group>
        ) : null}

        {vm.phase === "review" && plan ? (
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
                      value={vm.additionActions[a.id] ?? "import"}
                      onChange={(value) =>
                        vm.setAdditionAction(a.id, value as AdditionAction)
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
                  const res = vm.resolutions[conflict.id];
                  return (
                    <Stack key={conflict.id} gap="xs">
                      <RowGroup>
                        <Text size="sm">{conflict.id}</Text>
                        <SegmentedControl
                          size="xs"
                          data={RESOLUTION_DATA}
                          value={res?.action ?? "skip"}
                          onChange={(value) =>
                            vm.setResolution(
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
                            vm.setRenameTo(conflict.id, e.currentTarget.value)
                          }
                        />
                      ) : null}
                    </Stack>
                  );
                })}
              </Stack>
            ) : null}

            <Actions>
              <Button variant="default" onClick={vm.back}>
                Back
              </Button>
              <Button
                onClick={() => void vm.runImport()}
                disabled={vm.importCount === 0}
              >
                Import {vm.importCount} server{vm.importCount === 1 ? "" : "s"}
              </Button>
            </Actions>
          </SectionStack>
        ) : null}

        {vm.phase === "summary" ? (
          <SectionStack>
            <Text fw={600} size="sm">
              Import complete
            </Text>
            {vm.outcomes.map((o) => {
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
