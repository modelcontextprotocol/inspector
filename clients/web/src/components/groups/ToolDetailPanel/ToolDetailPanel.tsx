import {
  Button,
  Divider,
  Group,
  Image,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
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

// Outer column: title/annotations pin at top, the Execute footer pins at the
// bottom, and the middle (description + form + progress) scrolls when the
// enclosing card hits its `mah`. `mih: 0` lets the flex children shrink.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const PinnedHeader = Stack.withProps({
  gap: "md",
  flex: "0 0 auto",
});

// `0 1 auto` + `mih: 0`: shrinks to the available space and scrolls; a short
// form doesn't reserve extra height, keeping Execute snug below it.
const BodyScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const BodyStack = Stack.withProps({
  gap: "md",
});

const FooterRow = Group.withProps({
  justify: "flex-end",
  flex: "0 0 auto",
});

const TitleRow = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "center",
  miw: 0,
});

const ToolIcon = Image.withProps({
  w: 24,
  h: 24,
  fit: "contain",
});

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
  const { name, title, description, icons, annotations, inputSchema } = tool;
  const iconSrc = icons?.[0]?.src;

  return (
    <PanelStack>
      <PinnedHeader>
        <TitleRow>
          {iconSrc && <ToolIcon src={iconSrc} alt="" />}
          <ToolTitle>{resolveDisplayLabel(name, title)}</ToolTitle>
        </TitleRow>
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
      </PinnedHeader>

      <BodyScroll>
        <BodyStack>
          {description && <DescriptionText>{description}</DescriptionText>}

          <Divider />

          <SchemaForm
            schema={inputSchema}
            values={formValues}
            onChange={onFormChange}
            disabled={isExecuting}
          />

          {progress && <ProgressDisplay params={progress} />}
        </BodyStack>
      </BodyScroll>

      <FooterRow>
        {isExecuting && <CancelButton onClick={onCancel}>Cancel</CancelButton>}
        <Button
          size="md"
          onClick={onExecute}
          disabled={isExecuting}
          loading={isExecuting}
        >
          Execute Tool
        </Button>
      </FooterRow>
    </PanelStack>
  );
}
