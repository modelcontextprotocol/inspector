import {
  Accordion,
  Button,
  Divider,
  FileButton,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { InspectorServerJsonDraft } from "@inspector/core/mcp/types.js";

export interface ValidationResult {
  type: "success" | "warning" | "info" | "error";
  message: string;
}

export interface PackageInfo {
  registryType: string;
  identifier: string;
  runtimeHint: string;
}

export interface EnvVarInfo {
  name: string;
  description?: string;
  required: boolean;
  value: string;
}

export interface ImportServerJsonPanelProps {
  draft: InspectorServerJsonDraft;
  validation: ValidationResult[];
  packages?: PackageInfo[];
  envVars: EnvVarInfo[];
  onJsonChange: (content: string) => void;
  onSelectPackage: (index: number) => void;
  onEnvVarChange: (name: string, value: string) => void;
  onServerNameChange: (name: string) => void;
  /** The id derived from the server.json `name`, shown read-only in the
   *  Server Name disclosure (the override field replaces it when set). */
  defaultServerName?: string;
  onAddServer: () => void;
  /** Disables the Add Server button while the pasted content isn't valid. */
  addDisabled?: boolean;
  /**
   * Controls the "File Contents" disclosure. When `onFileContentsChange` is
   * provided the disclosure is controlled (the wiring layer can auto-collapse
   * it after content loads); otherwise it's uncontrolled and defaults to open.
   */
  fileContentsOpen?: boolean;
  onFileContentsChange?: (open: boolean) => void;
  /**
   * When true, the "File Contents" control is painted with its hover
   * background — used as a brief pre-collapse flash so the auto-collapse reads
   * intentionally.
   */
  fileContentsHighlight?: boolean;
  /**
   * Load server.json content from a file. When provided, a "Choose file…"
   * button is rendered next to the paste hint; the handler reads the file and
   * feeds its text back through `onJsonChange`.
   */
  onPickFile?: (file: File | null) => void;
}

const validationIcons: Record<
  ValidationResult["type"],
  { icon: string; color: string }
> = {
  success: { icon: "\u2713", color: "green" },
  warning: { icon: "\u26A0", color: "yellow" },
  info: { icon: "\u2139", color: "blue" },
  error: { icon: "\u2717", color: "red" },
};

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function formatPackageLabel(pkg: PackageInfo): string {
  return `${pkg.registryType}: ${pkg.identifier} (${pkg.runtimeHint})`;
}

export function ImportServerJsonPanel({
  draft,
  validation,
  packages,
  envVars,
  onJsonChange,
  onSelectPackage,
  onEnvVarChange,
  onServerNameChange,
  defaultServerName,
  onAddServer,
  addDisabled,
  fileContentsOpen,
  onFileContentsChange,
  fileContentsHighlight,
  onPickFile,
}: ImportServerJsonPanelProps) {
  // Validation results + the name-override field only make sense once there's
  // something to validate, so they stay hidden until content is pasted/loaded.
  const hasContent = draft.rawText.trim().length > 0;
  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <HintText>Paste server.json content, or load it from a file:</HintText>
        {onPickFile ? (
          <FileButton accept="application/json,.json" onChange={onPickFile}>
            {(props) => (
              <Button {...props} variant="default" size="xs">
                Choose file…
              </Button>
            )}
          </FileButton>
        ) : null}
      </Group>

      <Accordion
        variant="separated"
        transitionDuration={325}
        {...(onFileContentsChange
          ? {
              value: fileContentsOpen ? "file-contents" : null,
              onChange: (value: string | null) =>
                onFileContentsChange(value === "file-contents"),
            }
          : { defaultValue: "file-contents" })}
      >
        <Accordion.Item value="file-contents">
          <Accordion.Control
            bg={
              fileContentsHighlight
                ? "var(--mantine-color-default-hover)"
                : undefined
            }
          >
            File Contents
          </Accordion.Control>
          <Accordion.Panel>
            <Textarea
              value={draft.rawText}
              onChange={(e) => onJsonChange(e.currentTarget.value)}
              ff="monospace"
              autosize
              minRows={8}
              maxRows={15}
              rightSectionPointerEvents="auto"
              rightSection={
                draft.rawText ? (
                  <ClearButton onClick={() => onJsonChange("")} />
                ) : null
              }
            />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {hasContent && (
        <>
          <Accordion variant="separated" defaultValue="validation">
            <Accordion.Item value="validation">
              <Accordion.Control>Validation Results</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {validation.map((result, index) => {
                    const { icon, color } = validationIcons[result.type];
                    return (
                      <Group key={index} gap="xs">
                        <Text c={color}>{icon}</Text>
                        <Text size="sm">{result.message}</Text>
                      </Group>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          {packages && packages.length > 1 && (
            <>
              <Divider />
              <Title order={5}>Package Selection:</Title>
              <Radio.Group
                value={String(draft.selectedPackageIndex ?? 0)}
                onChange={(value) => onSelectPackage(Number(value))}
              >
                <Stack gap="xs">
                  {packages.map((pkg, index) => (
                    <Radio
                      key={index}
                      value={String(index)}
                      label={formatPackageLabel(pkg)}
                    />
                  ))}
                </Stack>
              </Radio.Group>
            </>
          )}

          {envVars.length > 0 && (
            <>
              <Divider />
              <Title order={5}>Environment Variables:</Title>
              {envVars.map((envVar) => (
                <TextInput
                  key={envVar.name}
                  label={envVar.name}
                  description={envVar.description}
                  withAsterisk={envVar.required}
                  value={envVar.value}
                  onChange={(e) =>
                    onEnvVarChange(envVar.name, e.currentTarget.value)
                  }
                  rightSectionPointerEvents="auto"
                  rightSection={
                    envVar.value ? (
                      <ClearButton
                        onClick={() => onEnvVarChange(envVar.name, "")}
                      />
                    ) : null
                  }
                />
              ))}
            </>
          )}

          <Accordion variant="separated" defaultValue="server-name">
            <Accordion.Item value="server-name">
              <Accordion.Control>Server Name</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <TextInput
                    label="From configuration"
                    description="The id derived from the server.json name."
                    value={defaultServerName ?? ""}
                    readOnly
                  />
                  <TextInput
                    label="Override"
                    description="Optional. Used instead of the name above."
                    value={draft.nameOverride ?? ""}
                    onChange={(e) => onServerNameChange(e.currentTarget.value)}
                    rightSectionPointerEvents="auto"
                    rightSection={
                      draft.nameOverride ? (
                        <ClearButton onClick={() => onServerNameChange("")} />
                      ) : null
                    }
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}

      <Group justify="flex-end">
        <Button onClick={onAddServer} disabled={addDisabled}>
          Add Server
        </Button>
      </Group>
    </Stack>
  );
}
