import { Button, Divider, Group, Stack, Text } from "@mantine/core";
import { AnnotationBadge } from "../../atoms/AnnotationBadge/AnnotationBadge";
import { ProgressDisplay } from "../../atoms/ProgressDisplay/ProgressDisplay";
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
  const hasAnnotations =
    annotations &&
    (annotations.audience ||
      annotations.readOnly ||
      annotations.destructive ||
      annotations.longRunning ||
      annotations.hints);

  return (
    <Stack gap="md" miw={0}>
      <Text fw={700} size="lg" truncate="end">
        {title ?? name}
      </Text>
      {title && (
        <Text size="sm" c="dimmed" truncate="end">
          {name}
        </Text>
      )}
      {hasAnnotations && (
        <Group gap="xs">
          {annotations.audience && (
            <AnnotationBadge
              label={annotations.audience}
              variant="audience"
            />
          )}
          {annotations.readOnly && (
            <AnnotationBadge label="read-only" variant="readOnly" />
          )}
          {annotations.destructive && (
            <AnnotationBadge label="destructive" variant="destructive" />
          )}
          {annotations.longRunning && (
            <AnnotationBadge label="long-run" variant="longRun" />
          )}
          {annotations.hints && (
            <Text size="xs" c="dimmed" fs="italic">
              {annotations.hints}
            </Text>
          )}
        </Group>
      )}

      {description && (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}

      <Divider />

      <SchemaForm
        schema={schema}
        values={formValues}
        onChange={onFormChange}
        disabled={isExecuting}
      />

      {progress && (
        <ProgressDisplay
          progress={progress.percent}
          description={progress.description}
        />
      )}

      <Group>
        <Button
          fullWidth
          onClick={onExecute}
          disabled={isExecuting}
          loading={isExecuting}
        >
          Execute Tool
        </Button>
        {isExecuting && (
          <Button variant="light" color="red" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </Group>
    </Stack>
  );
}
