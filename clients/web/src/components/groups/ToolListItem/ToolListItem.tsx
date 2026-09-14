import {
  Group,
  Image,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMemo } from "react";
import { RiAlertLine, RiErrorWarningLine } from "react-icons/ri";
import type { Tool } from "@modelcontextprotocol/client";
import {
  lintToolSchemas,
  summarizeToolFindings,
} from "@inspector/core/json/schemaLint.js";
import { resolveDisplayLabel } from "../../../utils/toolUtils";

export interface ToolListItemProps {
  tool: Tool;
  selected: boolean;
  onClick: () => void;
}

const ItemLabel = Text.withProps({
  fw: 500,
  truncate: true,
});

const ItemSubLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
  truncate: true,
});

const ItemBody = Stack.withProps({
  gap: 2,
  flex: 1,
  miw: 0,
});

const Row = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "flex-start",
});

const ToolIcon = Image.withProps({
  w: 20,
  h: 20,
  fit: "contain",
});

const ListItemButton = UnstyledButton.withProps({
  w: "100%",
  p: "sm",
  variant: "listItem",
});

// Schema-portability flag (#1005). Sits in the row rather than only in the
// detail panel so a problem tool is visible without clicking each one — the
// findings are rare enough that a marked row means something.
//
// Coloured from the same `--inspector-*` severity tokens the detail panel's
// findings list uses, rather than from Mantine's `color="yellow"`: those are
// the pairings this app already tunes against its own surfaces in both colour
// schemes, and the default yellow is what failed the a11y check there.
const SchemaFlagIcon = ThemeIcon.withProps({
  size: "xs",
  variant: "transparent",
  role: "img",
});

export function ToolListItem({ tool, selected, onClick }: ToolListItemProps) {
  const { name, title, icons } = tool;
  const iconSrc = icons?.[0]?.src;
  const findings = useMemo(() => lintToolSchemas(tool), [tool]);
  const hasError = findings.some((f) => f.severity === "error");
  // "1 error, 3 warnings" — the breakdown, not the total labelled with the
  // worst severity, which would announce a mixed tool as "4 errors".
  const summary = summarizeToolFindings(findings);

  return (
    <ListItemButton
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Row>
        {iconSrc && <ToolIcon src={iconSrc} alt="" />}
        <ItemBody>
          <ItemLabel>{resolveDisplayLabel(name, title)}</ItemLabel>
          {title && <ItemSubLabel>{name}</ItemSubLabel>}
        </ItemBody>
        {findings.length > 0 && (
          <Tooltip
            label={`Schema portability: ${summary} — select the tool for detail`}
            withArrow
          >
            <SchemaFlagIcon
              c={
                hasError
                  ? "var(--inspector-danger-text)"
                  : "var(--inspector-warning-text)"
              }
              aria-label={`Schema portability: ${summary}`}
            >
              {/* Distinct SHAPES, not just distinct colours: an octagon for an
                  error and a triangle for a warning, so the severity survives
                  for a colour-blind reader. The tooltip and the accessible
                  label name it in words as well. */}
              {hasError ? <RiErrorWarningLine /> : <RiAlertLine />}
            </SchemaFlagIcon>
          </Tooltip>
        )}
      </Row>
    </ListItemButton>
  );
}
