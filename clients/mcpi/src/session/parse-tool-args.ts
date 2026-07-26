import type { JsonValue } from "@inspector/core/mcp/index.js";

/**
 * Parse session `tools/call` positionals after the tool name:
 * - `key:=value` pairs (JSON-typed when the value parses as JSON, else string)
 * - a single inline JSON object (`{"message":"Foo"}`)
 */
export function parseToolCallPositionals(
  args: string[],
): Record<string, JsonValue> {
  if (args.length === 0) return {};

  const first = args[0]!;
  if (first.startsWith("{") || first.startsWith("[")) {
    if (args.length > 1) {
      throw new Error(
        "When using inline JSON, only one argument is allowed after the tool name.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(first);
    } catch (e) {
      throw new Error(
        `Invalid JSON tool arguments: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Inline JSON tool arguments must be a JSON object.");
    }
    return parsed as Record<string, JsonValue>;
  }

  const out: Record<string, JsonValue> = {};
  for (const pair of args) {
    const sep = pair.indexOf(":=");
    if (sep === -1) {
      throw new Error(
        `Invalid tool argument "${pair}". Use key:=value pairs or a JSON object.\n` +
          `Examples: message:=hello count:=10 '{"message":"hello"}'`,
      );
    }
    const key = pair.slice(0, sep);
    const rawValue = pair.slice(sep + 2);
    if (!key) {
      throw new Error(
        `Invalid tool argument "${pair}" — missing key before :=`,
      );
    }
    out[key] = autoParseValue(rawValue);
  }
  return out;
}

function autoParseValue(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

export type ResolveToolCallArgsInput = {
  toolNameFlag?: string;
  toolNamePos?: string;
  /** Remaining positionals after the tool-name slot. */
  toolArgsPos?: string[];
  toolArgFlag?: Record<string, JsonValue>;
  toolArgsJson?: string;
};

/**
 * Resolve tool name + arguments from positionals and/or legacy flags.
 * Styles are mutually exclusive: positionals, `--tool-arg`, or `--tool-args-json`.
 */
export function resolveToolCallArgs(input: ResolveToolCallArgsInput): {
  toolName: string | undefined;
  toolArg: Record<string, JsonValue>;
} {
  const flagArgs = input.toolArgFlag ?? {};
  const hasFlagArgs = Object.keys(flagArgs).length > 0;
  const hasJson = input.toolArgsJson !== undefined;

  let toolName = input.toolNameFlag ?? input.toolNamePos;
  let positionals = [...(input.toolArgsPos ?? [])];

  // `tools/call --tool-name echo message:=Foo` — commander puts message:=Foo
  // in the toolName slot when the name came from the flag.
  if (input.toolNameFlag && input.toolNamePos) {
    positionals = [input.toolNamePos, ...positionals];
    toolName = input.toolNameFlag;
  }

  const hasPositionals = positionals.length > 0;
  const styles = [hasPositionals, hasFlagArgs, hasJson].filter(Boolean).length;
  if (styles > 1) {
    throw new Error(
      "Tool arguments must use one style: key:=value / JSON positionals, " +
        "--tool-arg, or --tool-args-json.",
    );
  }

  if (hasJson) {
    return {
      toolName,
      toolArg: parseJsonObject(input.toolArgsJson!, "--tool-args-json"),
    };
  }
  if (hasPositionals) {
    return { toolName, toolArg: parseToolCallPositionals(positionals) };
  }
  return { toolName, toolArg: flagArgs };
}

function parseJsonObject(raw: string, flag: string): Record<string, JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${flag} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object.`);
  }
  return parsed as Record<string, JsonValue>;
}
