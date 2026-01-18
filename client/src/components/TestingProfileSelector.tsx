import { Select } from '@mantine/core';
import type { TestingProfile } from '@modelcontextprotocol/inspector-core';

interface TestingProfileSelectorProps {
  profiles: TestingProfile[];
  activeProfileId: string;
  onChange: (profileId: string) => void;
  size?: 'xs' | 'sm' | 'md';
  label?: string;
}

export function TestingProfileSelector({
  profiles,
  activeProfileId,
  onChange,
  size = 'sm',
  label,
}: TestingProfileSelectorProps) {
  const data = profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));

  return (
    <Select
      label={label}
      size={size}
      value={activeProfileId}
      onChange={(value) => value && onChange(value)}
      data={data}
      allowDeselect={false}
    />
  );
}
