import { Button, Divider, Stack, Text } from "@mantine/core";
import { MdPlayArrow } from "react-icons/md";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export interface AppDetailPanelProps {
  tool: Tool;
  formValues: Record<string, unknown>;
  isOpening: boolean;
  onFormChange: (values: Record<string, unknown>) => void;
  onOpenApp: () => void;
}

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function hasMissingRequiredFields(
  schema: Tool["inputSchema"],
  values: Record<string, unknown>,
): boolean {
  const required = schema.required ?? [];
  return required.some((field) => {
    const value = values[field];
    return value === undefined || value === null || value === "";
  });
}

export function AppDetailPanel({
  tool,
  formValues,
  isOpening,
  onFormChange,
  onOpenApp,
}: AppDetailPanelProps) {
  const { description, inputSchema } = tool;
  const hasErrors = hasMissingRequiredFields(inputSchema, formValues);
  const disabled = isOpening || hasErrors;
  const hasFields = Object.keys(inputSchema.properties ?? {}).length > 0;

  return (
    <Stack gap="md" miw={0}>
      {description && <DescriptionText>{description}</DescriptionText>}

      {hasFields && <Divider />}

      {/* Form stays editable while validation fails so users can finish
          filling required fields. The disabled-when-incomplete gate is on
          the Open App button below, not on the form itself. */}
      <SchemaForm
        schema={inputSchema}
        values={formValues}
        onChange={onFormChange}
        disabled={isOpening}
      />

      <Button
        size="md"
        fullWidth
        leftSection={<MdPlayArrow aria-hidden size={18} />}
        onClick={onOpenApp}
        disabled={disabled}
        loading={isOpening}
      >
        Open App
      </Button>
    </Stack>
  );
}
