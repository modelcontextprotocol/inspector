import {
  Button,
  Divider,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";

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
  jsonContent: string;
  validationResults: ValidationResult[];
  packages?: PackageInfo[];
  selectedPackageIndex: number;
  envVars: EnvVarInfo[];
  serverName: string;
  onJsonChange: (content: string) => void;
  onValidate: () => void;
  onSelectPackage: (index: number) => void;
  onEnvVarChange: (name: string, value: string) => void;
  onServerNameChange: (name: string) => void;
  onAddServer: () => void;
  onCancel: () => void;
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

export function ImportServerJsonPanel({
  jsonContent,
  validationResults,
  packages,
  selectedPackageIndex,
  envVars,
  serverName,
  onJsonChange,
  onValidate,
  onSelectPackage,
  onEnvVarChange,
  onServerNameChange,
  onAddServer,
  onCancel,
}: ImportServerJsonPanelProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Import MCP Registry server.json</Title>

      <Text size="sm" c="dimmed">
        Paste server.json content or drag and drop a file:
      </Text>

      <Textarea
        value={jsonContent}
        onChange={(e) => onJsonChange(e.currentTarget.value)}
        ff="monospace"
        autosize
        minRows={8}
        maxRows={15}
      />

      <Divider />

      <Title order={5}>Validation Results:</Title>

      {validationResults.map((result, index) => {
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
            value={String(selectedPackageIndex)}
            onChange={(value) => onSelectPackage(Number(value))}
          >
            <Stack gap="xs">
              {packages.map((pkg, index) => (
                <Radio
                  key={index}
                  value={String(index)}
                  label={`${pkg.registryType}: ${pkg.identifier} (${pkg.runtimeHint})`}
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
            />
          ))}
        </>
      )}

      <Divider />

      <TextInput
        label="Server Name (optional override)"
        value={serverName}
        onChange={(e) => onServerNameChange(e.currentTarget.value)}
      />

      <Group justify="flex-end">
        <Button variant="light" onClick={onValidate}>
          Validate Again
        </Button>
        <Button variant="light" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onAddServer}>Add Server</Button>
      </Group>
    </Stack>
  );
}
