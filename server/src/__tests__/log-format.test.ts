/**
 * Unit tests for log-format.ts
 *
 * The proxy's SSE and query log lines must name what was forwarded without
 * printing any value. Each test renders the same template index.ts uses,
 * captures what console.log receives, and asserts no value reaches it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { formatHeaderNamesForLog, formatQueryForLog } from "../log-format.js";

const AUTH_VALUE = "Bearer upstream-value-7c51";
const API_KEY_VALUE = "api-key-value-91aa";
const TENANT_VALUE = "tenant-value-0d3f";

function captureLog(emit: () => void): string {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    emit();
    return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatHeaderNamesForLog", () => {
  const headers: Record<string, string> = {
    Authorization: AUTH_VALUE,
    "X-Api-Key": API_KEY_VALUE,
    "X-Tenant-Token": TENANT_VALUE,
    Accept: "text/event-stream",
  };

  it("lists every header name", () => {
    expect(JSON.parse(formatHeaderNamesForLog(headers))).toEqual([
      "Authorization",
      "X-Api-Key",
      "X-Tenant-Token",
      "Accept",
    ]);
  });

  it("keeps every header value out of the SSE log line", () => {
    const url = "https://example.test/sse";
    const output = captureLog(() =>
      console.log(
        `SSE transport: url=${url}, headers=${formatHeaderNamesForLog(headers)}`,
      ),
    );

    expect(output).toContain("Authorization");
    expect(output).toContain("X-Api-Key");
    for (const value of Object.values(headers)) {
      expect(output).not.toContain(value);
    }
    expect(output).not.toContain("upstream-value");
  });

  it("renders an empty header set as an empty list", () => {
    expect(formatHeaderNamesForLog({})).toBe("[]");
  });
});

describe("formatQueryForLog", () => {
  it("reduces the stdio env parameter to its variable names", () => {
    const query = {
      transportType: "stdio",
      command: "node",
      args: "server.js",
      env: JSON.stringify({ API_TOKEN: API_KEY_VALUE, TENANT: TENANT_VALUE }),
    };
    const output = captureLog(() =>
      console.log("Query parameters:", formatQueryForLog(query)),
    );

    expect(output).toContain("API_TOKEN");
    expect(output).toContain("TENANT");
    expect(output).toContain('"command":"node"');
    expect(output).not.toContain(API_KEY_VALUE);
    expect(output).not.toContain(TENANT_VALUE);
  });

  it("passes a query without env through unchanged", () => {
    const query = { transportType: "sse", url: "https://example.test/sse" };
    expect(formatQueryForLog(query)).toBe(JSON.stringify(query));
  });

  it.each([
    ["unparseable JSON", `{"API_TOKEN":"${API_KEY_VALUE}"`],
    ["a JSON array", JSON.stringify([API_KEY_VALUE])],
    ["a JSON string", JSON.stringify(API_KEY_VALUE)],
    ["JSON null", "null"],
    ["a non-string value", [API_KEY_VALUE]],
  ])("omits an env given as %s", (_label, env) => {
    const output = formatQueryForLog({ transportType: "stdio", env });
    expect(output).not.toContain(API_KEY_VALUE);
    expect(JSON.parse(output).env).toBe("[omitted]");
  });
});
