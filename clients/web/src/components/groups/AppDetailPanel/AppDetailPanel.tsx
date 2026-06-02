import { Button, Divider, Stack, Text } from "@mantine/core";
import { MdPlayArrow } from "react-icons/md";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import { hasInputFields } from "../../../utils/toolUtils";
import { hasMissingRequiredFields } from "../../../utils/jsonUtils";

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
  const hasFields = hasInputFields(tool);

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
