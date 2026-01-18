import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  Button,
  Text,
  Divider,
  Paper,
  ActionIcon,
  Table,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type {
  TestingProfile,
  SamplingProviderType,
  ModelOverride,
} from '@modelcontextprotocol/inspector-core';

interface TestingProfileEditorProps {
  profile: TestingProfile;
  onSave: (profile: TestingProfile) => void;
  onCancel: () => void;
  isNew: boolean;
  existingNames: string[];
}

export function TestingProfileEditor({
  profile,
  onSave,
  onCancel,
  isNew,
  existingNames,
}: TestingProfileEditorProps) {
  // Form state
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description || '');
  const [samplingProvider, setSamplingProvider] =
    useState<SamplingProviderType>(profile.samplingProvider);
  const [autoRespond, setAutoRespond] = useState(profile.autoRespond);
  const [defaultResponse, setDefaultResponse] = useState(
    profile.defaultResponse || ''
  );
  const [defaultModel, setDefaultModel] = useState(profile.defaultModel || '');
  const [defaultStopReason, setDefaultStopReason] = useState<
    'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse'
  >(profile.defaultStopReason || 'endTurn');
  const [modelOverrides, setModelOverrides] = useState<ModelOverride[]>(
    profile.modelOverrides || []
  );
  const [elicitationAutoRespond, setElicitationAutoRespond] = useState(
    profile.elicitationAutoRespond || false
  );

  // Reset form when profile changes
  useEffect(() => {
    setName(profile.name);
    setDescription(profile.description || '');
    setSamplingProvider(profile.samplingProvider);
    setAutoRespond(profile.autoRespond);
    setDefaultResponse(profile.defaultResponse || '');
    setDefaultModel(profile.defaultModel || '');
    setDefaultStopReason(profile.defaultStopReason || 'endTurn');
    setModelOverrides(profile.modelOverrides || []);
    setElicitationAutoRespond(profile.elicitationAutoRespond || false);
  }, [profile]);

  // Validation
  const nameError = (() => {
    if (!name.trim()) return 'Name is required';
    if (
      existingNames.some(
        (n) => n.toLowerCase() === name.toLowerCase() && n !== profile.name
      )
    ) {
      return 'A profile with this name already exists';
    }
    return null;
  })();

  const isValid = !nameError;

  // Model overrides handlers
  const addOverride = () => {
    setModelOverrides([...modelOverrides, { pattern: '', response: '' }]);
  };

  const removeOverride = (index: number) => {
    setModelOverrides(modelOverrides.filter((_, i) => i !== index));
  };

  const updateOverride = (
    index: number,
    field: 'pattern' | 'response',
    value: string
  ) => {
    const updated = [...modelOverrides];
    updated[index] = { ...updated[index], [field]: value };
    setModelOverrides(updated);
  };

  // Save handler
  const handleSave = () => {
    if (!isValid) return;

    const updatedProfile: TestingProfile = {
      id: profile.id,
      name: name.trim(),
      description: description.trim() || undefined,
      samplingProvider,
      autoRespond,
      defaultResponse: defaultResponse.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
      defaultStopReason,
      modelOverrides:
        modelOverrides.filter((o) => o.pattern.trim()).length > 0
          ? modelOverrides.filter((o) => o.pattern.trim())
          : undefined,
      elicitationAutoRespond,
      elicitationDefaults: profile.elicitationDefaults,
    };

    onSave(updatedProfile);
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {isNew ? 'New Profile' : `Editing: ${profile.name}`}
          </Text>
        </Group>

        <Divider />

        {/* Basic Info */}
        <TextInput
          label="Profile Name"
          placeholder="Enter profile name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          required
        />

        <Textarea
          label="Description"
          placeholder="Optional description of this profile"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
        />

        <Divider />

        {/* Provider Settings */}
        <Select
          label="Sampling Provider"
          description="How sampling requests should be handled"
          value={samplingProvider}
          onChange={(v) => setSamplingProvider(v as SamplingProviderType)}
          data={[
            { value: 'manual', label: 'Manual' },
            { value: 'mock', label: 'Mock/Template' },
          ]}
        />

        <Checkbox
          label="Auto-respond to sampling requests"
          description="Automatically send response without user interaction"
          checked={autoRespond}
          onChange={(e) => setAutoRespond(e.currentTarget.checked)}
        />

        {samplingProvider === 'mock' && (
          <>
            <Textarea
              label="Default Response Template"
              placeholder="The default response to use for sampling requests"
              value={defaultResponse}
              onChange={(e) => setDefaultResponse(e.target.value)}
              minRows={3}
            />

            <Group grow>
              <TextInput
                label="Default Model"
                placeholder="e.g., mock-model-1.0"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              />

              <Select
                label="Default Stop Reason"
                value={defaultStopReason}
                onChange={(v) =>
                  setDefaultStopReason(
                    v as 'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse'
                  )
                }
                data={[
                  { value: 'endTurn', label: 'End Turn' },
                  { value: 'stopSequence', label: 'Stop Sequence' },
                  { value: 'maxTokens', label: 'Max Tokens' },
                  { value: 'toolUse', label: 'Tool Use' },
                ]}
              />
            </Group>

            <Divider />

            {/* Model Overrides */}
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <div>
                  <Text size="sm" fw={500}>
                    Model-Specific Overrides
                  </Text>
                  <Text size="xs" c="dimmed">
                    Match model hints with patterns (e.g., claude-*, gpt-*)
                  </Text>
                </div>
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={addOverride}
                >
                  Add Override
                </Button>
              </Group>

              {modelOverrides.length === 0 ? (
                <Text size="sm" c="dimmed" fs="italic">
                  No model-specific overrides configured
                </Text>
              ) : (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: '30%' }}>Pattern</Table.Th>
                      <Table.Th>Response Template</Table.Th>
                      <Table.Th style={{ width: 50 }}></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {modelOverrides.map((override, index) => (
                      <Table.Tr key={index}>
                        <Table.Td>
                          <TextInput
                            placeholder="claude-*"
                            value={override.pattern}
                            onChange={(e) =>
                              updateOverride(index, 'pattern', e.target.value)
                            }
                            size="xs"
                          />
                        </Table.Td>
                        <Table.Td>
                          <TextInput
                            placeholder="Response for this model..."
                            value={override.response}
                            onChange={(e) =>
                              updateOverride(index, 'response', e.target.value)
                            }
                            size="xs"
                          />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={() => removeOverride(index)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </>
        )}

        <Divider />

        {/* Elicitation Settings */}
        <Checkbox
          label="Auto-respond to elicitation requests"
          description="Automatically submit elicitation forms with default values"
          checked={elicitationAutoRespond}
          onChange={(e) => setElicitationAutoRespond(e.currentTarget.checked)}
        />

        <Divider />

        {/* Actions */}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {isNew ? 'Create Profile' : 'Save Changes'}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
