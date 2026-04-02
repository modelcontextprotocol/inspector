import { Switch } from "@mantine/core";

export interface ConnectionToggleProps {
  checked: boolean;
  loading: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export function ConnectionToggle({
  checked,
  loading,
  disabled,
  onChange,
}: ConnectionToggleProps) {
  return (
    <Switch
      size="lg"
      checked={checked || loading}
      disabled={disabled || loading}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}
