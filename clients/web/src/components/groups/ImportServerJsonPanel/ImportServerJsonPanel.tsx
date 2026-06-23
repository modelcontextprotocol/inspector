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
  onAddServer: () => void;
  /** Disables the Add Server button while the pasted content isn't valid. */
  addDisabled?: boolean;
  onCancel: () => void;
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
  onAddServer,
  addDisabled,
  onCancel,
  onPickFile,
}: ImportServerJsonPanelProps) {
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

      <Accordion variant="separated" defaultValue="file-contents">
        <Accordion.Item value="file-contents">
          <Accordion.Control>File Contents</Accordion.Control>
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

      <Divider />

      <Title order={5}>Validation Results:</Title>

      {validation.map((result, index) => {
        const { icon, color } = validationIcons[result.type];
        return (
          <Group key={index} gap="xs">
            <Text c={color}>{icon}</Text>
            <Text size="sm">{result.message}</Text>
          </Group>
        );
      })}

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

      <Divider />

      <TextInput
        label="Server Name (optional override)"
        value={draft.nameOverride ?? ""}
        onChange={(e) => onServerNameChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          draft.nameOverride ? (
            <ClearButton onClick={() => onServerNameChange("")} />
          ) : null
        }
      />

      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onAddServer} disabled={addDisabled}>
          Add Server
        </Button>
      </Group>
    </Stack>
  );
}
