import { describe, it, expect } from "vitest";
import { parse as shellParseArgs, quote as shellQuoteArgs } from "shell-quote";

// Mirrors the logic in the /config endpoint
function processArgsForClient(rawArgs: string): string {
  if (!rawArgs) return rawArgs;
  try {
    const parsed = JSON.parse(rawArgs);
    if (Array.isArray(parsed)) {
      return shellQuoteArgs(parsed);
    }
  } catch {
    // Not JSON — legacy shell string, pass through unchanged
  }
  return rawArgs;
}

// Mirrors the logic in createTransport
function parseArgsForTransport(rawArgs: string): string[] {
  if (!rawArgs) return [];
  try {
    const parsed = JSON.parse(rawArgs);
    if (Array.isArray(parsed)) {
      return parsed as string[];
    }
  } catch {
    // Not JSON
  }
  return shellParseArgs(rawArgs) as string[];
}

describe("start.js serialization: args array → JSON string", () => {
  it("preserves args with spaces when serialized as JSON array", () => {
    const mcpServerArgs = [
      "--tool",
      "date",
      "--description",
      "get todays date",
      "--command",
      "date",
    ];
    const serialized = JSON.stringify(mcpServerArgs);
    expect(serialized).toBe(
      '["--tool","date","--description","get todays date","--command","date"]',
    );
  });

  it("round-trips args with spaces through JSON without corruption", () => {
    const original = ["--description", "get todays date", "--command", "date"];
    const deserialized = JSON.parse(JSON.stringify(original));
    expect(deserialized).toEqual(original);
  });
});

describe("/config endpoint: JSON array → shell-quoted string for client UI", () => {
  it("converts JSON array to properly quoted shell string", () => {
    const rawArgs = JSON.stringify([
      "--tool",
      "date",
      "--description",
      "get todays date",
      "--command",
      "date",
    ]);
    const result = processArgsForClient(rawArgs);
    expect(result).toBe(
      "--tool date --description 'get todays date' --command date",
    );
  });

  it("passes legacy shell string through unchanged", () => {
    const legacyArgs =
      "--tool date --description 'get todays date' --command date";
    expect(processArgsForClient(legacyArgs)).toBe(legacyArgs);
  });

  it("handles empty args string", () => {
    expect(processArgsForClient("")).toBe("");
  });

  it("handles args with no spaces (no quoting needed)", () => {
    const rawArgs = JSON.stringify(["--verbose", "--port", "8080"]);
    expect(processArgsForClient(rawArgs)).toBe("--verbose --port 8080");
  });

  it("handles args with embedded single quotes", () => {
    const rawArgs = JSON.stringify(["--message", "it's working"]);
    const result = processArgsForClient(rawArgs);
    // shell-quote uses double-quotes when value contains a single quote
    const parsed = shellParseArgs(result) as string[];
    expect(parsed).toEqual(["--message", "it's working"]);
  });

  it("handles args with embedded double quotes", () => {
    const rawArgs = JSON.stringify(["--message", 'say "hello"']);
    const result = processArgsForClient(rawArgs);
    const parsed = shellParseArgs(result) as string[];
    expect(parsed).toEqual(["--message", 'say "hello"']);
  });
});

describe("createTransport: args string → parsed args array", () => {
  it("accepts JSON array directly and returns elements as-is", () => {
    const jsonArgs = JSON.stringify(["--description", "get todays date"]);
    const result = parseArgsForTransport(jsonArgs);
    expect(result).toEqual(["--description", "get todays date"]);
    expect(result).toHaveLength(2);
  });

  it("falls back to shellParseArgs for shell-quoted string", () => {
    const shellArgs = "--description 'get todays date'";
    const result = parseArgsForTransport(shellArgs);
    expect(result).toEqual(["--description", "get todays date"]);
    expect(result).toHaveLength(2);
  });

  it("parses plain args without quotes correctly", () => {
    const result = parseArgsForTransport("--verbose --port 8080");
    expect(result).toEqual(["--verbose", "--port", "8080"]);
  });

  it("handles empty string", () => {
    expect(parseArgsForTransport("")).toEqual([]);
  });
});

describe("full round-trip: start.js → /config → createTransport", () => {
  it("args with spaces survive the complete pipeline", () => {
    // Step 1: start.js serializes the args array as JSON
    const originalArgs = [
      "--tool",
      "date",
      "--description",
      "get todays date",
      "--command",
      "date",
    ];
    const serialized = JSON.stringify(originalArgs);

    // Step 2: /config converts JSON array → shell-quoted string for UI
    const clientDisplayString = processArgsForClient(serialized);
    expect(clientDisplayString).toBe(
      "--tool date --description 'get todays date' --command date",
    );

    // Step 3: client sends display string; createTransport parses it
    const finalArgs = parseArgsForTransport(clientDisplayString);
    expect(finalArgs).toEqual(originalArgs);
    expect(finalArgs).toHaveLength(6);
  });

  it("args without spaces survive the complete pipeline unchanged", () => {
    const originalArgs = ["--verbose", "--port", "8080"];
    const serialized = JSON.stringify(originalArgs);
    const clientDisplayString = processArgsForClient(serialized);
    expect(clientDisplayString).toBe("--verbose --port 8080");
    const finalArgs = parseArgsForTransport(clientDisplayString);
    expect(finalArgs).toEqual(originalArgs);
  });

  it("legacy manually-typed shell string (no JSON) still works", () => {
    // User types args manually in the UI text box — never goes through start.js
    const manuallyTyped = "--tool date --description 'get todays date'";
    // /config would return this unchanged (it's not JSON)
    const fromConfig = processArgsForClient(manuallyTyped);
    expect(fromConfig).toBe(manuallyTyped);
    // createTransport parses it correctly
    const finalArgs = parseArgsForTransport(fromConfig);
    expect(finalArgs).toEqual([
      "--tool",
      "date",
      "--description",
      "get todays date",
    ]);
  });
});
