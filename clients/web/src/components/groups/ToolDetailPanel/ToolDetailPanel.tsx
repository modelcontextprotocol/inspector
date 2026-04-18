import { Button, Divider, Group, Stack, Text } from "@mantine/core";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ProgressDisplay } from "../../elements/ProgressDisplay/ProgressDisplay";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import type { JsonSchema } from "../SchemaForm/SchemaForm";

export interface ToolAnnotations {
  audience?: string;
  readOnly?: boolean;
  destructive?: boolean;
  longRunning?: boolean;
  hints?: string;
}

export interface ToolDetailPanelProps {
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  schema: JsonSchema;
  formValues: Record<string, unknown>;
  isExecuting: boolean;
  progress?: { percent: number; description?: string };
  onFormChange: (values: Record<string, unknown>) => void;
  onExecute: () => void;
  onCancel: () => void;
}

const ToolTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const HintsText = Text.withProps({
  size: "xs",
  c: "dimmed",
  fs: "italic",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const CancelButton = Button.withProps({
  variant: "light",
  color: "red",
});

function resolveTitle(name: string, title?: string): string {
  return title ?? name;
}

function hasAnyAnnotation(annotations?: ToolAnnotations): boolean {
  return !!(
    annotations &&
    (annotations.audience ||
      annotations.readOnly ||
      annotations.destructive ||
      annotations.longRunning ||
      annotations.hints)
  );
}

export function ToolDetailPanel({
  name,
  title,
  description,
  annotations,
  schema,
  formValues,
  isExecuting,
  progress,
  onFormChange,
  onExecute,
  onCancel,
}: ToolDetailPanelProps) {
  return (
    <Stack gap="md" miw={0}>
      <ToolTitle>{resolveTitle(name, title)}</ToolTitle>
      {hasAnyAnnotation(annotations) && annotations && (
        <Group gap="xs">
          {annotations.audience && (
            <AnnotationBadge
              facet="audience"
              value={
                annotations.audience.split(", ") as ("user" | "assistant")[]
              }
            />
          )}
          {annotations.readOnly && (
            <AnnotationBadge facet="readOnlyHint" value={true} />
          )}
          {annotations.destructive && (
            <AnnotationBadge facet="destructiveHint" value={true} />
          )}
          {annotations.longRunning && (
            <AnnotationBadge facet="longRunHint" value={true} />
          )}
          {annotations.hints && <HintsText>{annotations.hints}</HintsText>}
        </Group>
      )}

      {description && <DescriptionText>{description}</DescriptionText>}

      <Divider />

      <SchemaForm
        schema={schema}
        values={formValues}
        onChange={onFormChange}
        disabled={isExecuting}
      />

      {progress && (
        <ProgressDisplay
          params={{
            progress: progress.percent,
            message: progress.description,
          }}
        />
      )}

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
