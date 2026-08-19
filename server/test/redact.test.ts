import { test } from "node:test";
import assert from "node:assert/strict";

import {
  redactSensitiveEntries,
  redactHeadersForLogging,
  redactQueryForLogging,
} from "../src/redact.js";

test("redactSensitiveEntries: redacts common secret-bearing env vars and keeps benign ones", () => {
  const input = {
    GITHUB_TOKEN: "ghp_xxx",
    PATH: "/usr/bin",
    AWS_ACCESS_KEY_ID: "AKIA...",
  };
  assert.deepEqual(redactSensitiveEntries(input), {
    GITHUB_TOKEN: "***",
    PATH: "/usr/bin",
    AWS_ACCESS_KEY_ID: "***",
  });
});

test("redactSensitiveEntries: bare KEY and API_KEY are redacted", () => {
  assert.deepEqual(redactSensitiveEntries({ KEY: "k" }), { KEY: "***" });
  assert.deepEqual(redactSensitiveEntries({ API_KEY: "k" }), {
    API_KEY: "***",
  });
  assert.deepEqual(redactSensitiveEntries({ "api-key": "k" }), {
    "api-key": "***",
  });
});

test("redactSensitiveEntries: word containing 'key' is NOT redacted (boundary)", () => {
  // The boundary in /(^|_)key($|_)/i prevents naive substring matches like
  // MONKEY, KEYBOARD, etc. from being flagged as secrets.
  assert.deepEqual(redactSensitiveEntries({ MONKEY: "m" }), { MONKEY: "m" });
  assert.deepEqual(redactSensitiveEntries({ KEYBOARD: "k" }), {
    KEYBOARD: "k",
  });
});

test("redactSensitiveEntries: Authorization header is redacted", () => {
  assert.deepEqual(redactSensitiveEntries({ Authorization: "Bearer x" }), {
    Authorization: "***",
  });
});

test("redactQueryForLogging: env JSON is parsed and redacted entry-by-entry", () => {
  const env = JSON.stringify({ PASSWORD: "p", PORT: "5432" });
  const out = redactQueryForLogging({ env, transport: "stdio" }) as Record<
    string,
    unknown
  >;
  assert.deepEqual(out.env, { PASSWORD: "***", PORT: "5432" });
  assert.equal(out.transport, "stdio");
});

test("redactQueryForLogging: malformed env falls back to ***", () => {
  const out = redactQueryForLogging({ env: "not-json" }) as Record<
    string,
    unknown
  >;
  assert.equal(out.env, "***");
});

test("redactQueryForLogging: missing env passes through unchanged", () => {
  assert.deepEqual(redactQueryForLogging({ transport: "sse" }), {
    transport: "sse",
  });
});

test("redactQueryForLogging: non-string env is redacted wholesale", () => {
  // Express produces an array for `?env=a&env=b` and an object for `?env[x]=y`.
  // Neither is a valid env payload, so neither may be logged verbatim.
  assert.equal(
    (redactQueryForLogging({ env: ["a", "b"] }) as Record<string, unknown>).env,
    "***",
  );
  assert.equal(
    (
      redactQueryForLogging({ env: { PASSWORD: "p" } }) as Record<
        string,
        unknown
      >
    ).env,
    "***",
  );
});

test("redactQueryForLogging: env parsing to a non-flat value is redacted wholesale", () => {
  // A nested object would otherwise slip past the shallow key-based redactor.
  const nested = JSON.stringify({ SAFE: { PASSWORD: "p" } });
  assert.equal(
    (redactQueryForLogging({ env: nested }) as Record<string, unknown>).env,
    "***",
  );

  const array = JSON.stringify(["PASSWORD=p"]);
  assert.equal(
    (redactQueryForLogging({ env: array }) as Record<string, unknown>).env,
    "***",
  );

  const scalar = JSON.stringify(42);
  assert.equal(
    (redactQueryForLogging({ env: scalar }) as Record<string, unknown>).env,
    "***",
  );
});

test("redactHeadersForLogging: every forwarded header value is redacted by name-agnostic default", () => {
  // `x-custom-auth-header(s)` lets a caller name any header as its credential
  // carrier, so a name-pattern check would miss `X-Foo` entirely.
  assert.deepEqual(
    redactHeadersForLogging({
      Authorization: "Bearer secret",
      "X-Foo": "secret",
      "X-Access-Key": "secret",
      "mcp-protocol-version": "2025-06-18",
    }),
    {
      Authorization: "***",
      "X-Foo": "***",
      "X-Access-Key": "***",
      "mcp-protocol-version": "***",
    },
  );
});

test("redactHeadersForLogging: known non-credential headers keep their value", () => {
  assert.deepEqual(
    redactHeadersForLogging({
      Accept: "text/event-stream",
      "Last-Event-ID": "42",
    }),
    { Accept: "text/event-stream", "Last-Event-ID": "42" },
  );
});
