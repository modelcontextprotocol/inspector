import { test } from "node:test";
import assert from "node:assert/strict";

import {
  redactSensitiveEntries,
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
