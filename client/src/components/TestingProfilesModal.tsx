import { useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Button,
  Text,
  Divider,
  Paper,
  Radio,
  Badge,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react';
import { useExecution } from '@/context/ExecutionContext';
import { TestingProfileSelector } from './TestingProfileSelector';
import { TestingProfileEditor } from './TestingProfileEditor';
import type { TestingProfile } from '@modelcontextprotocol/inspector-core';

interface TestingProfilesModalProps {
  opened: boolean;
  onClose: () => void;
}

export function TestingProfilesModal({
  opened,
  onClose,
}: TestingProfilesModalProps) {
  const { state, dispatch } = useExecution();

  // Local state
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editingProfile, setEditingProfile] = useState<TestingProfile | null>(
    null
  );
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Get selected profile
  const selectedProfile = state.profiles.find(
    (p) => p.id === selectedProfileId
  );

  // Handlers
  const handleNewProfile = () => {
    const newProfile: TestingProfile = {
      id: `profile-${Date.now()}`,
      name: 'New Profile',
      samplingProvider: 'mock',
      autoRespond: false,
    };
    setEditingProfile(newProfile);
    setIsCreatingNew(true);
    setIsEditing(true);
  };

  const handleEditSelected = () => {
    if (selectedProfile) {
      setEditingProfile({ ...selectedProfile });
      setIsCreatingNew(false);
      setIsEditing(true);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedProfileId && selectedProfileId !== state.activeProfileId) {
      dispatch({ type: 'DELETE_PROFILE', profileId: selectedProfileId });
      setSelectedProfileId(null);
    }
  };

  const handleSaveProfile = (profile: TestingProfile) => {
    if (isCreatingNew) {
      dispatch({ type: 'ADD_PROFILE', profile });
    } else {
      dispatch({ type: 'UPDATE_PROFILE', profile });
    }
    setIsEditing(false);
    setEditingProfile(null);
    setIsCreatingNew(false);
    setSelectedProfileId(profile.id);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingProfile(null);
    setIsCreatingNew(false);
  };

  const handleActiveProfileChange = (profileId: string) => {
    dispatch({ type: 'SET_ACTIVE_PROFILE', profileId });
  };

  // Check if delete is allowed
  const canDelete =
    selectedProfileId !== null &&
    selectedProfileId !== state.activeProfileId &&
    state.profiles.length > 1;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Testing Profiles"
      size="lg"
    >
      <Stack gap="md">
        {/* Active Profile Selector */}
        <Group justify="space-between" align="flex-end">
          <TestingProfileSelector
            profiles={state.profiles}
            activeProfileId={state.activeProfileId}
            onChange={handleActiveProfileChange}
            label="Active Profile"
          />
          <Button
            variant="subtle"
            leftSection={<IconPlus size={16} />}
            onClick={handleNewProfile}
            disabled={isEditing}
          >
            New Profile
          </Button>
        </Group>

        <Divider />

        {/* Saved Profiles List */}
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Saved Profiles
          </Text>

          <Radio.Group
            value={selectedProfileId || ''}
            onChange={setSelectedProfileId}
          >
            <Stack gap="xs">
              {state.profiles.map((profile) => (
                <Paper
                  key={profile.id}
                  withBorder
                  p="sm"
                  radius="md"
                  style={{
                    cursor: 'pointer',
                    backgroundColor:
                      selectedProfileId === profile.id
                        ? 'var(--mantine-color-dark-6)'
                        : undefined,
                  }}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <Radio value={profile.id} />
                      <div>
                        <Group gap="xs">
                          <Text size="sm" fw={500}>
                            {profile.name}
                          </Text>
                          {profile.id === state.activeProfileId && (
                            <Badge size="xs" color="green">
                              Active
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {profile.samplingProvider === 'manual'
                            ? 'Manual'
                            : 'Mock'}
                          {profile.autoRespond ? ', auto-respond' : ''}
                          {profile.description
                            ? ` - ${profile.description}`
                            : ''}
                        </Text>
                      </div>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </Radio.Group>

          {/* Profile Actions */}
          <Group justify="flex-end" gap="xs">
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPencil size={14} />}
              onClick={handleEditSelected}
              disabled={!selectedProfileId || isEditing}
            >
              Edit Selected
            </Button>
            <Button
              variant="subtle"
              size="xs"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={handleDeleteSelected}
              disabled={!canDelete || isEditing}
            >
              Delete
            </Button>
          </Group>
        </Stack>

        {/* Profile Editor */}
        {isEditing && editingProfile && (
          <>
            <Divider />
            <TestingProfileEditor
              profile={editingProfile}
              onSave={handleSaveProfile}
              onCancel={handleCancelEdit}
              isNew={isCreatingNew}
              existingNames={state.profiles.map((p) => p.name)}
            />
          </>
        )}

        {/* Close Button */}
        {!isEditing && (
          <>
            <Divider />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Close
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
