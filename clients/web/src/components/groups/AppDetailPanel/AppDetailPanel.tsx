import { Button, Divider, ScrollArea, Stack, Text } from "@mantine/core";
import { MdPlayArrow } from "react-icons/md";
import type { Tool } from "@modelcontextprotocol/client";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import { hasInputFields } from "../../../utils/toolUtils";
import {
  hasMissingRequiredFields,
  toFormSchema,
} from "../../../utils/jsonUtils";

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

// Fills the available height inside AppsScreen's full-height card and scrolls
// the form (description + fields + Open App) when it would overflow, instead of
// bleeding past the viewport. `mih: 0` lets it shrink within the flex parent;
// standalone (no flex parent) it just sizes to content.
const PanelScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
});

export function AppDetailPanel({
  tool,
  formValues,
  isOpening,
  onFormChange,
  onOpenApp,
}: AppDetailPanelProps) {
  const { description, inputSchema } = tool;
  // Narrow the SDK protocol schema to the form renderer's schema type. A Tool's
  // `inputSchema` is always an object per the SDK types, so `toFormSchema` never
  // returns null here — the `?? {}` is a defensive fallback that can't be hit.
  /* v8 ignore next -- unreachable: Tool.inputSchema is always an object */
  const formSchema = toFormSchema(inputSchema) ?? {};
  const hasErrors = hasMissingRequiredFields(formSchema, formValues);
  const disabled = isOpening || hasErrors;
  const hasFields = hasInputFields(tool);

  return (
    <PanelScroll>
      <PanelStack>
        {description && <DescriptionText>{description}</DescriptionText>}

        {hasFields && <Divider />}

        {/* Form stays editable while validation fails so users can finish
            filling required fields. The disabled-when-incomplete gate is on
            the Open App button below, not on the form itself. */}
        <SchemaForm
          schema={formSchema}
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
          data-testid="open-app"
        >
          Open App
        </Button>
      </PanelStack>
    </PanelScroll>
  );
}
