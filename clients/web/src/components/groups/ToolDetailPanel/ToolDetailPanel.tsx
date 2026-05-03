import { Button, Divider, Group, Stack, Text } from "@mantine/core";
import type {
  ProgressNotification,
  Tool,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveDisplayLabel } from "../../../utils/toolUtils";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ProgressDisplay } from "../../elements/ProgressDisplay/ProgressDisplay";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export type ToolProgress = Pick<
  ProgressNotification["params"],
  "progress" | "total" | "message"
>;

export interface ToolDetailPanelProps {
  tool: Tool;
  formValues: Record<string, unknown>;
  isExecuting: boolean;
  progress?: ToolProgress;
  onFormChange: (values: Record<string, unknown>) => void;
  onExecute: () => void;
  onCancel: () => void;
}

const ToolTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const CancelButton = Button.withProps({
  variant: "subtle",
  color: "red",
});

function hasAnyAnnotation(annotations?: ToolAnnotations): boolean {
  return !!(
    annotations &&
    (annotations.readOnlyHint ||
      annotations.destructiveHint ||
      annotations.idempotentHint ||
      annotations.openWorldHint)
  );
}

export function ToolDetailPanel({
  tool,
  formValues,
  isExecuting,
  progress,
  onFormChange,
  onExecute,
  onCancel,
}: ToolDetailPanelProps) {
  const { name, title, description, annotations, inputSchema } = tool;

  return (
    <Stack gap="md" miw={0}>
      <ToolTitle>{resolveDisplayLabel(name, title)}</ToolTitle>
      {hasAnyAnnotation(annotations) && annotations && (
        <Group gap="xs">
          {annotations.readOnlyHint && (
            <AnnotationBadge facet="readOnlyHint" value={true} />
          )}
          {annotations.destructiveHint && (
            <AnnotationBadge facet="destructiveHint" value={true} />
          )}
          {annotations.idempotentHint && (
            <AnnotationBadge facet="idempotentHint" value={true} />
          )}
          {annotations.openWorldHint && (
            <AnnotationBadge facet="openWorldHint" value={true} />
          )}
        </Group>
      )}

      {description && <DescriptionText>{description}</DescriptionText>}

      <Divider />

      <SchemaForm
        schema={inputSchema}
        values={formValues}
        onChange={onFormChange}
        disabled={isExecuting}
      />

      {progress && <ProgressDisplay params={progress} />}

      <Group justify="flex-end">
        {isExecuting && <CancelButton onClick={onCancel}>Cancel</CancelButton>}
        <Button
          size="md"
          onClick={onExecute}
          disabled={isExecuting}
          loading={isExecuting}
        >
          Execute Tool
        </Button>
      </Group>
    </Stack>
  );
}
