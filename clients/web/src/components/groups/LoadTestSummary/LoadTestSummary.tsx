import { Alert, Stack, Table, Text } from "@mantine/core";
import {
  loadSummaryWarnings,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  LOAD_LATENCY_COLUMNS,
  loadErrorTallies,
  loadLatencyCells,
  loadOverviewFigures,
  loadStageRows,
  loadStepRows,
  type LoadBreakdownRow,
} from "../../../utils/loadTest";

/**
 * A finished load run (#2911), as tables: the headline counts, the latency
 * percentiles of the successful and the failed calls, the per-step rows of a
 * scenario, the per-stage rows of a stepped run, and the error tallies. The
 * same `LoadSummary` the CLI prints as JSON — nothing is re-derived here
 * beyond formatting.
 */
export interface LoadTestSummaryProps {
  summary: LoadSummary;
}

const SummaryStack = Stack.withProps({ gap: "md" });

const SectionTitle = Text.withProps({ size: "sm", fw: 600 });

const NoteText = Text.withProps({ size: "sm", c: "dimmed" });

// The figures are short and many; xs keeps the latency table's eight columns
// on one line inside the modal.
const FigureTable = Table.withProps({
  variant: "manifest",
  striped: true,
  withTableBorder: true,
  verticalSpacing: 4,
});

const StoppedAlert = Alert.withProps({ variant: "light", color: "yellow" });

const WarningAlert = Alert.withProps({ variant: "light", color: "orange" });

function BreakdownTable({
  label,
  rows,
}: {
  label: string;
  rows: LoadBreakdownRow[];
}) {
  return (
    <>
      <SectionTitle>{label}</SectionTitle>
      <FigureTable aria-label={label}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{label === "Steps" ? "Step" : "Stage"}</Table.Th>
            <Table.Th>Requests</Table.Th>
            <Table.Th>OK</Table.Th>
            <Table.Th>Failed</Table.Th>
            <Table.Th>Error rate</Table.Th>
            <Table.Th>Throughput</Table.Th>
            <Table.Th>p50</Table.Th>
            <Table.Th>p99</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.key}>
              <Table.Td>{row.label}</Table.Td>
              <Table.Td>{row.requests}</Table.Td>
              <Table.Td>{row.ok}</Table.Td>
              <Table.Td>{row.failed}</Table.Td>
              <Table.Td>{row.errorRate}</Table.Td>
              <Table.Td>{row.throughput}</Table.Td>
              <Table.Td>{row.p50}</Table.Td>
              <Table.Td>{row.p99}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </FigureTable>
    </>
  );
}

export function LoadTestSummary({ summary }: LoadTestSummaryProps) {
  const figures = loadOverviewFigures(summary);
  const stepRows = loadStepRows(summary);
  const stageRows = loadStageRows(summary);
  const tallies = loadErrorTallies(summary);
  // `loadSummaryWarnings` leaves an interrupted run out (whoever stopped it
  // knows); the panel still says so, since the figures cover a partial run.
  const warnings = loadSummaryWarnings(summary);
  const stop = summary.stoppedEarly;
  const { warmup } = summary;

  return (
    <SummaryStack>
      {stop?.reason === "interrupted" && (
        <StoppedAlert title="Stopped early">
          The run was stopped; the figures cover the calls that completed.
        </StoppedAlert>
      )}
      {warnings.map((warning) => (
        <WarningAlert key={warning}>{warning}</WarningAlert>
      ))}

      <SectionTitle>Overview</SectionTitle>
      <FigureTable aria-label="Overview">
        <Table.Tbody>
          {figures.map((figure) => (
            <Table.Tr key={figure.label}>
              <Table.Th>{figure.label}</Table.Th>
              <Table.Td>{figure.value}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </FigureTable>

      <SectionTitle>Latency</SectionTitle>
      <FigureTable aria-label="Latency">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Calls</Table.Th>
            {LOAD_LATENCY_COLUMNS.map(([key, label]) => (
              <Table.Th key={key}>{label}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Th>Successful</Table.Th>
            {loadLatencyCells(summary.latencyMs).map((cell, i) => (
              <Table.Td key={LOAD_LATENCY_COLUMNS[i]![0]}>{cell}</Table.Td>
            ))}
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Failed</Table.Th>
            {loadLatencyCells(summary.errorLatencyMs).map((cell, i) => (
              <Table.Td key={LOAD_LATENCY_COLUMNS[i]![0]}>{cell}</Table.Td>
            ))}
          </Table.Tr>
        </Table.Tbody>
      </FigureTable>

      {warmup && (
        <NoteText>
          {`Warm-up: ${warmup.requests} calls (${warmup.ok} ok, ${warmup.failed} failed) over ${(warmup.durationMs / 1000).toFixed(1)} s, left out of every figure above.`}
        </NoteText>
      )}

      {stepRows.length > 0 && <BreakdownTable label="Steps" rows={stepRows} />}
      {stageRows.length > 0 && (
        <BreakdownTable label="Stages" rows={stageRows} />
      )}

      {tallies.length > 0 && (
        <>
          <SectionTitle>Errors</SectionTitle>
          <FigureTable aria-label="Errors">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Message</Table.Th>
                <Table.Th>Count</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tallies.map((tally) => (
                <Table.Tr key={tally.key}>
                  <Table.Td>{tally.kind}</Table.Td>
                  <Table.Td>{tally.message}</Table.Td>
                  <Table.Td>{tally.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </FigureTable>
        </>
      )}
    </SummaryStack>
  );
}
