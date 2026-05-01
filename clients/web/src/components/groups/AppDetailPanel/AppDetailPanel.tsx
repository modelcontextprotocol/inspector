import { Button, Divider, Group, Image, Stack, Text } from "@mantine/core";
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

const PanelTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const TitleRow = Group.withProps({
  gap: "sm",
  align: "center",
  wrap: "nowrap",
});

const PanelIcon = Image.withProps({
  w: 24,
  h: 24,
  fit: "contain",
});

function resolveTitle(name: string, title?: string): string {
  return title ?? name;
}

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
  const { name, title, description, icons, inputSchema } = tool;
  const iconSrc = icons?.[0]?.src;
  const hasErrors = hasMissingRequiredFields(inputSchema, formValues);
  const disabled = isOpening || hasErrors;

  return (
    <Stack gap="md" miw={0}>
      <TitleRow>
        {iconSrc && <PanelIcon src={iconSrc} alt="" />}
        <PanelTitle>{resolveTitle(name, title)}</PanelTitle>
      </TitleRow>

      {description && <DescriptionText>{description}</DescriptionText>}

      <Divider />

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
