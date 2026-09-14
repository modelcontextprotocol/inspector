import { Accordion, Badge, Code, Group, Stack, Text } from "@mantine/core";
import { RiArrowRightSLine } from "react-icons/ri";
import {
  describeSchemaPath,
  type SchemaFinding,
} from "@inspector/core/json/schemaLint.js";

/** The one accordion item, so the controlled value has a stable name. */
const SECTION_VALUE = "schema-portability";

// Section heading + count badge, side by side. A `Text` renders a `<p>`, so the
// heading must never *wrap* the badge — a `<div>` inside a `<p>` is invalid
// HTML that React reports as a hydration error. Same arrangement the Skills
// pane's Conformance header uses.
const SectionHeading = Text.withProps({
  variant: "sectionHeading",
});

const CountBadge = Badge.withProps({
  size: "xs",
  variant: "light",
});

const InlineRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

// The findings themselves, inside the panel.
const FindingsBody = Stack.withProps({
  gap: "xs",
});

// One finding: severity badge + path on the first row, then issue and fix.
const FindingBlock = Stack.withProps({
  gap: 2,
});

const FindingHeadRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  align: "center",
});

const FindingText = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const FindingsNote = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

/**
 * Severity label.
 *
 * Deliberately coloured text rather than a filled `Badge`: a filled `yellow`
 * badge puts white on `yellow-7`, which at this size is 3.92:1 and fails the
 * story's a11y check, and neither `autoContrast` (yellow-7 sits below
 * Mantine's default luminance threshold, so it stays white) nor
 * `variant="light"` (3.34:1) fixes it. The `--inspector-*` severity tokens are
 * the pairings this app already uses against its own surfaces, in both colour
 * schemes.
 */
const SeverityLabel = Text.withProps({
  size: "xs",
  fw: 700,
  tt: "uppercase",
});

/**
 * Severity → text-colour token. `error` is a construct a shipping MCP client
 * refuses outright; `warning` is one handled unevenly.
 */
function severityColor(severity: SchemaFinding["severity"]): string {
  return severity === "error"
    ? "var(--inspector-danger-text)"
    : "var(--inspector-warning-text)";
}

/**
 * Colour for the count badge, which summarises the whole list rather than one
 * finding. There is deliberately no green case: the section renders nothing at
 * all for a tool with no findings, so a clean badge could never appear.
 */
function summaryColor(errorCount: number): string {
  return errorCount > 0 ? "red" : "yellow";
}

export interface SchemaFindingsListProps {
  /** Findings for one tool, in walk order. Renders nothing when empty. */
  findings: readonly SchemaFinding[];
  /**
   * Whether the findings are revealed. Controlled by the caller because the
   * preference is global rather than per tool — see `useSchemaFindingsExpanded`.
   */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

/**
 * Tool-schema portability findings for one tool (#1005).
 *
 * The same verdict the CLI's `--strict` report and the TUI's detail pane show
 * — all three read `core/json/schemaLint`, so they cannot disagree about
 * whether a schema is portable, only about how much room they have to say so.
 *
 * Collapsed behind its count badge by default (#2205). The findings address the
 * *server author*, but they render in the panel the *caller* fills in, above
 * the argument form; on a server with broadly unportable schemas that put the
 * same wall of text ahead of every tool's first input. The badge stays visible
 * either way, so nothing about the tool's standing is hidden by the closed
 * state.
 */
export function SchemaFindingsList({
  findings,
  expanded,
  onExpandedChange,
}: SchemaFindingsListProps) {
  if (findings.length === 0) return null;

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.length - errorCount;

  return (
    <Stack gap="xs" data-testid="schema-findings">
      {/* Inline, not a `.withProps()` subcomponent: `Accordion` is a compound,
          `multiple`-discriminated generic, and baking props into it loses the
          JSX call signature (see AGENTS.md).

          `variant="disclosure"` is the app's existing collapsible-section look
          (#1462) — the same one the Skills pane's Conformance section uses, so
          a section heading with a severity badge reads the same wherever it
          appears. `multiple` only so the controlled value is an array; there is
          one item. */}
      <Accordion
        multiple
        variant="disclosure"
        chevron={<RiArrowRightSLine />}
        value={expanded ? [SECTION_VALUE] : []}
        onChange={(value) => onExpandedChange(value.includes(SECTION_VALUE))}
      >
        <Accordion.Item value={SECTION_VALUE}>
          <Accordion.Control>
            <InlineRow>
              <SectionHeading>Schema portability</SectionHeading>
              <CountBadge color={summaryColor(errorCount)}>
                {errorCount} error(s), {warningCount} warning(s)
              </CountBadge>
            </InlineRow>
          </Accordion.Control>
          <Accordion.Panel>
            <FindingsBody>
              {findings.map((finding, index) => (
                <FindingBlock
                  key={`${finding.schema}-${finding.path}-${finding.rule}-${index}`}
                >
                  <FindingHeadRow>
                    <SeverityLabel c={severityColor(finding.severity)}>
                      {finding.severity}
                    </SeverityLabel>
                    <Code>
                      {describeSchemaPath(finding.schema, finding.path)}
                    </Code>
                  </FindingHeadRow>
                  <FindingText>{finding.issue}</FindingText>
                  <FindingText>Fix: {finding.suggestion}</FindingText>
                </FindingBlock>
              ))}
              <FindingsNote>
                These constructs are legal JSON Schema but are refused or
                mishandled by some MCP clients, so a tool can work here and fail
                there.
              </FindingsNote>
            </FindingsBody>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
