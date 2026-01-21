import { useState, useCallback } from 'react';
import {
  IconCheck,
  IconAlertTriangle,
  IconInfoCircle,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  TextInput,
  Textarea,
  Stack,
  Group,
  Text,
  Box,
  Badge,
  Select,
  Radio,
  FileButton,
} from '@mantine/core';

// server.json schema types
interface EnvVar {
  name: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  choices?: string[];
}

interface Argument {
  type: 'positional' | 'named';
  name?: string;
  value?: string;
  valueHint?: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  choices?: string[];
}

interface Package {
  registryType: string;
  identifier: string;
  version: string;
  runtimeHint?: string;
  transport: { type: string };
  packageArguments?: Argument[];
  runtimeArguments?: Argument[];
  environmentVariables?: EnvVar[];
}

interface Remote {
  type: 'streamable-http' | 'sse';
  url: string;
  headers?: EnvVar[];
}

interface ServerJson {
  $schema?: string;
  name: string;
  description: string;
  title?: string;
  version: string;
  packages?: Package[];
  remotes?: Remote[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

interface ImportServerJsonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (config: {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    env: Record<string, string>;
  }) => void;
}

function validateServerJson(jsonText: string): {
  result: ValidationResult;
  parsed: ServerJson | null;
} {
  const result: ValidationResult = {
    valid: false,
    errors: [],
    warnings: [],
    info: [],
  };

  if (!jsonText.trim()) {
    return { result, parsed: null };
  }

  let parsed: ServerJson;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    result.errors.push('Invalid JSON syntax');
    return { result, parsed: null };
  }

  // Basic schema validation
  if (!parsed.name) {
    result.errors.push('Missing required field: name');
  }
  if (!parsed.description) {
    result.errors.push('Missing required field: description');
  }
  if (!parsed.version) {
    result.errors.push('Missing required field: version');
  }

  if (!parsed.packages?.length && !parsed.remotes?.length) {
    result.errors.push('Must have at least one package or remote');
  }

  if (result.errors.length === 0) {
    result.valid = true;
    result.info.push('Schema validation passed');

    if (parsed.packages?.length) {
      const pkg = parsed.packages[0];
      result.info.push(
        `Package found: ${pkg.identifier} (${pkg.registryType})`
      );
      if (pkg.runtimeHint) {
        result.info.push(`Runtime hint: ${pkg.runtimeHint}`);
      }
      result.info.push(`Transport: ${pkg.transport?.type || 'stdio'}`);
    }

    if (parsed.remotes?.length) {
      const remote = parsed.remotes[0];
      result.info.push(`Remote found: ${remote.url} (${remote.type})`);
    }

    // Check for required env vars
    const pkg = parsed.packages?.[0];
    const requiredEnvVars = pkg?.environmentVariables?.filter(
      (v) => v.isRequired
    );
    if (requiredEnvVars?.length) {
      requiredEnvVars.forEach((v) => {
        result.warnings.push(`Environment variable ${v.name} is required`);
      });
    }
  }

  return { result, parsed };
}

export function ImportServerJsonModal({
  open,
  onOpenChange,
  onImport,
}: ImportServerJsonModalProps) {
  const [jsonText, setJsonText] = useState('');
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [parsedJson, setParsedJson] = useState<ServerJson | null>(null);
  const [sourceType, setSourceType] = useState<'package' | 'remote'>('package');
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [selectedRemoteIndex, setSelectedRemoteIndex] = useState(0);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [serverNameOverride, setServerNameOverride] = useState('');

  const handleValidate = useCallback(() => {
    const { result, parsed } = validateServerJson(jsonText);
    setValidationResult(result);
    setParsedJson(parsed);

    if (parsed) {
      // Determine source type
      if (parsed.packages?.length && !parsed.remotes?.length) {
        setSourceType('package');
      } else if (parsed.remotes?.length && !parsed.packages?.length) {
        setSourceType('remote');
      }

      // Initialize env vars with defaults
      const pkg = parsed.packages?.[selectedPackageIndex];
      if (pkg?.environmentVariables) {
        const defaults: Record<string, string> = {};
        pkg.environmentVariables.forEach((v) => {
          if (v.default) {
            defaults[v.name] = v.default;
          }
        });
        setEnvVars(defaults);
      }

      // Initialize headers with defaults
      const remote = parsed.remotes?.[selectedRemoteIndex];
      if (remote?.headers) {
        const defaults: Record<string, string> = {};
        remote.headers.forEach((h) => {
          if (h.default) {
            defaults[h.name] = h.default;
          }
        });
        setHeaders(defaults);
      }
    }
  }, [jsonText, selectedPackageIndex, selectedRemoteIndex]);

  const handleClear = () => {
    setJsonText('');
    setValidationResult(null);
    setParsedJson(null);
    setEnvVars({});
    setHeaders({});
    setServerNameOverride('');
  };

  const handleFileSelect = (file: File | null) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setJsonText(text);
      };
      reader.readAsText(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setJsonText(text);
      };
      reader.readAsText(file);
    }
  };

  const handleImport = () => {
    if (!parsedJson) return;

    const name =
      serverNameOverride.trim() || parsedJson.title || parsedJson.name;

    if (sourceType === 'package' && parsedJson.packages?.length) {
      const pkg = parsedJson.packages[selectedPackageIndex];
      const runtimeHint = pkg.runtimeHint || 'npx';
      const command = `${runtimeHint} -y ${pkg.identifier}`;

      onImport({
        name,
        transport: 'stdio',
        command,
        env: envVars,
      });
    } else if (sourceType === 'remote' && parsedJson.remotes?.length) {
      const remote = parsedJson.remotes[selectedRemoteIndex];

      onImport({
        name,
        transport: remote.type === 'sse' ? 'sse' : 'http',
        url: remote.url,
        env: headers,
      });
    }

    onOpenChange(false);
  };

  const canImport = () => {
    if (!validationResult?.valid || !parsedJson) return false;

    // Check required env vars are filled
    if (sourceType === 'package') {
      const pkg = parsedJson.packages?.[selectedPackageIndex];
      const requiredVars =
        pkg?.environmentVariables?.filter((v) => v.isRequired) || [];
      for (const v of requiredVars) {
        if (!envVars[v.name]?.trim()) return false;
      }
    }

    // Check required headers are filled
    if (sourceType === 'remote') {
      const remote = parsedJson.remotes?.[selectedRemoteIndex];
      const requiredHeaders =
        remote?.headers?.filter((h) => h.isRequired) || [];
      for (const h of requiredHeaders) {
        if (!headers[h.name]?.trim()) return false;
      }
    }

    return true;
  };

  const selectedPackage = parsedJson?.packages?.[selectedPackageIndex];
  const selectedRemote = parsedJson?.remotes?.[selectedRemoteIndex];

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Import MCP Registry server.json"
      size="xl"
    >
      <Stack gap="lg">
        {/* JSON Input */}
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Paste server.json content or drag and drop a file:
          </Text>
          <Box
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={`{
  "$schema": "https://static.modelcontextprotocol.io/schemas/...",
  "name": "io.github.user/my-server",
  "description": "A sample MCP server",
  "version": "1.0.0",
  "packages": [{
    "registryType": "npm",
    "identifier": "my-mcp-server",
    ...
  }]
}`}
              minRows={8}
              styles={{ input: { fontFamily: 'monospace', fontSize: '12px' } }}
            />
          </Box>
          <Group justify="flex-end" gap="xs">
            <FileButton onChange={handleFileSelect} accept=".json">
              {(props) => (
                <Button
                  {...props}
                  variant="default"
                  size="xs"
                  leftSection={<IconUpload size={14} />}
                >
                  Browse...
                </Button>
              )}
            </FileButton>
            <Button variant="default" size="xs" onClick={handleClear}>
              Clear
            </Button>
            <Button size="xs" onClick={handleValidate}>
              Validate
            </Button>
          </Group>
        </Stack>

        {/* Validation Results */}
        {validationResult && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>Validation Results:</Text>
            <Box
              p="sm"
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-sm)',
                backgroundColor: 'var(--mantine-color-body)',
              }}
            >
              <Stack gap={4}>
                {validationResult.errors.map((error, i) => (
                  <Group key={i} gap="xs">
                    <IconX size={16} color="var(--mantine-color-red-6)" />
                    <Text size="sm" c="red">{error}</Text>
                  </Group>
                ))}
                {validationResult.warnings.map((warning, i) => (
                  <Group key={i} gap="xs">
                    <IconAlertTriangle size={16} color="var(--mantine-color-yellow-6)" />
                    <Text size="sm" c="yellow">{warning}</Text>
                  </Group>
                ))}
                {validationResult.info.map((info, i) => (
                  <Group key={i} gap="xs">
                    {i === 0 ? (
                      <IconCheck size={16} color="var(--mantine-color-green-6)" />
                    ) : (
                      <IconInfoCircle size={16} color="var(--mantine-color-blue-6)" />
                    )}
                    <Text size="sm" c={i === 0 ? 'green' : 'blue'}>{info}</Text>
                  </Group>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}

        {/* Source Type Selection */}
        {parsedJson &&
          parsedJson.packages?.length &&
          parsedJson.remotes?.length && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>Source Type:</Text>
              <Radio.Group
                value={sourceType}
                onChange={(v) => setSourceType(v as 'package' | 'remote')}
              >
                <Group gap="lg">
                  <Radio value="package" label="Package (local execution)" />
                  <Radio value="remote" label="Remote (HTTP endpoint)" />
                </Group>
              </Radio.Group>
            </Stack>
          )}

        {/* Package Selection */}
        {sourceType === 'package' &&
          parsedJson?.packages &&
          parsedJson.packages.length > 1 && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>Package Selection:</Text>
              <Radio.Group
                value={String(selectedPackageIndex)}
                onChange={(v) => setSelectedPackageIndex(Number(v))}
              >
                <Stack gap="xs">
                  {parsedJson.packages.map((pkg, i) => (
                    <Box
                      key={i}
                      p="xs"
                      style={{
                        border: '1px solid var(--mantine-color-default-border)',
                        borderRadius: 'var(--mantine-radius-sm)',
                      }}
                    >
                      <Radio
                        value={String(i)}
                        label={
                          <Group gap="xs">
                            <Text size="sm" fw={500}>{pkg.registryType}:</Text>
                            <Text size="sm">{pkg.identifier}</Text>
                            {pkg.runtimeHint && (
                              <Badge variant="light" size="sm">
                                {pkg.runtimeHint}
                              </Badge>
                            )}
                          </Group>
                        }
                      />
                    </Box>
                  ))}
                </Stack>
              </Radio.Group>
            </Stack>
          )}

        {/* Remote Selection */}
        {sourceType === 'remote' &&
          parsedJson?.remotes &&
          parsedJson.remotes.length > 1 && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>Remote Selection:</Text>
              <Radio.Group
                value={String(selectedRemoteIndex)}
                onChange={(v) => setSelectedRemoteIndex(Number(v))}
              >
                <Stack gap="xs">
                  {parsedJson.remotes.map((remote, i) => (
                    <Box
                      key={i}
                      p="xs"
                      style={{
                        border: '1px solid var(--mantine-color-default-border)',
                        borderRadius: 'var(--mantine-radius-sm)',
                      }}
                    >
                      <Radio
                        value={String(i)}
                        label={
                          <Group gap="xs">
                            <Badge variant="light" size="sm">
                              {remote.type}
                            </Badge>
                            <Text size="sm">{remote.url}</Text>
                          </Group>
                        }
                      />
                    </Box>
                  ))}
                </Stack>
              </Radio.Group>
            </Stack>
          )}

        {/* Environment Variables (for packages) */}
        {sourceType === 'package' &&
          selectedPackage?.environmentVariables?.length && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>Environment Variables:</Text>
              <Box
                p="sm"
                style={{
                  border: '1px solid var(--mantine-color-default-border)',
                  borderRadius: 'var(--mantine-radius-sm)',
                }}
              >
                <Stack gap="sm">
                  {selectedPackage.environmentVariables.map((envVar) => (
                    <Stack key={envVar.name} gap={4}>
                      {envVar.choices?.length ? (
                        <Select
                          label={
                            <>
                              {envVar.name}
                              {envVar.isRequired && (
                                <Text component="span" c="red" ml={4}>*</Text>
                              )}
                            </>
                          }
                          value={envVars[envVar.name] || ''}
                          onChange={(v) =>
                            setEnvVars({ ...envVars, [envVar.name]: v || '' })
                          }
                          data={envVar.choices}
                          placeholder="Select..."
                          description={envVar.description}
                        />
                      ) : (
                        <TextInput
                          label={
                            <>
                              {envVar.name}
                              {envVar.isRequired && (
                                <Text component="span" c="red" ml={4}>*</Text>
                              )}
                            </>
                          }
                          type={envVar.isSecret ? 'password' : 'text'}
                          placeholder={envVar.default || ''}
                          value={envVars[envVar.name] || ''}
                          onChange={(e) =>
                            setEnvVars({
                              ...envVars,
                              [envVar.name]: e.target.value,
                            })
                          }
                          description={envVar.description}
                        />
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}

        {/* Headers (for remotes) */}
        {sourceType === 'remote' && selectedRemote?.headers?.length && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>Headers:</Text>
            <Box
              p="sm"
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-sm)',
              }}
            >
              <Stack gap="sm">
                {selectedRemote.headers.map((header) => (
                  <Stack key={header.name} gap={4}>
                    {header.choices?.length ? (
                      <Select
                        label={
                          <>
                            {header.name}
                            {header.isRequired && (
                              <Text component="span" c="red" ml={4}>*</Text>
                            )}
                          </>
                        }
                        value={headers[header.name] || ''}
                        onChange={(v) =>
                          setHeaders({ ...headers, [header.name]: v || '' })
                        }
                        data={header.choices}
                        placeholder="Select..."
                        description={header.description}
                      />
                    ) : (
                      <TextInput
                        label={
                          <>
                            {header.name}
                            {header.isRequired && (
                              <Text component="span" c="red" ml={4}>*</Text>
                            )}
                          </>
                        }
                        type={header.isSecret ? 'password' : 'text'}
                        placeholder={header.default || ''}
                        value={headers[header.name] || ''}
                        onChange={(e) =>
                          setHeaders({
                            ...headers,
                            [header.name]: e.target.value,
                          })
                        }
                        description={header.description}
                      />
                    )}
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}

        {/* Server Name Override */}
        {parsedJson && (
          <TextInput
            label="Server Name (optional override)"
            placeholder={parsedJson.title || parsedJson.name}
            value={serverNameOverride}
            onChange={(e) => setServerNameOverride(e.target.value)}
          />
        )}

        {/* Footer */}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={handleValidate}>
            Validate Again
          </Button>
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport()}>
            Add Server
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
