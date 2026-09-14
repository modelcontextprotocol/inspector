import { Button, Divider, ScrollArea, Stack, Text } from "@mantine/core";
import { useState } from "react";
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

const OpenAppButton = Button.withProps({
  size: "md",
  fullWidth: true,
  leftSection: <MdPlayArrow aria-hidden size={18} />,
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
  // A field holding text it could not turn into a value (unparseable JSON, an
  // unrepresentable number) reports `undefined`, which is indistinguishable
  // from empty once it reaches `formValues` — so the form reports it directly
  // and an optional argument can no longer be dropped silently (#2020).
  const [hasInvalidDraft, setHasInvalidDraft] = useState(false);
  const disabled = isOpening || hasErrors || hasInvalidDraft;
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
          // Like ToolDetailPanel, this panel is reused across app selections
          // rather than remounted (AppsScreen.handleSelect swaps
          // selectedAppName + formValues in place), so the form needs the app
          // tool's name to drop another app's in-progress field text. See
          // SchemaFormProps.resetKey.
          resetKey={tool.name}
          onValidityChange={setHasInvalidDraft}
          // These values become `tools/call` arguments, so a raw-JSON draft the
          // client would retype is refused rather than sent as something other
          // than what the editor shows (#2171).
          enforceToolArgumentTypes
        />

        <OpenAppButton
          onClick={onOpenApp}
          disabled={disabled}
          loading={isOpening}
          data-testid="open-app"
        >
          Open App
        </OpenAppButton>
      </PanelStack>
    </PanelScroll>
  );
}
