import { Code, Table } from "@mantine/core";
import { useMemo } from "react";
import Papa from "papaparse";

/**
 * Render CSV text as a Mantine `Table`. Parsed with papaparse in header mode;
 * only the first {@link MAX_ROWS} rows are shown to keep large files cheap. When
 * the text doesn't parse as a header-bearing table (no detected columns), the
 * raw text is shown in a plain wrapping `Code` block instead of throwing.
 */
export interface CsvTableProps {
  /** The CSV document text. */
  text: string;
}

/** Cap rendered rows so a huge CSV doesn't mount thousands of DOM nodes. */
export const MAX_ROWS = 100;

const PlainCode = Code.withProps({ block: true, variant: "wrapping" });

interface ParsedCsv {
  fields: string[];
  rows: string[][];
}

function parseCsv(text: string): ParsedCsv | null {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const fields = result.meta.fields ?? [];
  if (fields.length === 0 || result.data.length === 0) {
    return null;
  }
  const rows = result.data
    .slice(0, MAX_ROWS)
    .map((row) => fields.map((field) => row[field] ?? ""));
  return { fields, rows };
}

export function CsvTable({ text }: CsvTableProps) {
  const parsed = useMemo(() => parseCsv(text), [text]);

  if (!parsed) {
    return <PlainCode>{text}</PlainCode>;
  }

  return (
    <Table striped highlightOnHover withTableBorder withColumnBorders>
      <Table.Thead>
        <Table.Tr>
          {parsed.fields.map((field) => (
            <Table.Th key={field}>{field}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {parsed.rows.map((row, rowIndex) => (
          <Table.Tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <Table.Td key={cellIndex}>{cell}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
