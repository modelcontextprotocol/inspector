import { test } from "node:test";
import assert from "node:assert/strict";

import {
  redactHeadersForLogging,
  redactQueryForLogging,
} from "../src/redact.js";

test("redactHeadersForLogging: every forwarded header value is redacted", () => {
  // Sensitivity cannot be inferred from a header name: `getHttpHeaders`
  // forwards whatever name arrives in `x-custom-auth-header(s)`, so the
  // credential can land under any name at all -- including one an allowlist
  // would consider safe.
  assert.deepEqual(
    redactHeadersForLogging({
      Authorization: "Bearer secret",
      "X-Foo": "secret",
      "X-Access-Key": "secret",
      "mcp-protocol-version": "2025-06-18",
      Accept: "text/event-stream",
      accept: "secret",
      "last-event-id": "secret",
    }),
    {
      Authorization: "***",
      "X-Foo": "***",
      "X-Access-Key": "***",
      "mcp-protocol-version": "***",
      Accept: "***",
      accept: "***",
      "last-event-id": "***",
    },
  );
});

test("redactHeadersForLogging: an empty header set stays empty", () => {
  assert.deepEqual(redactHeadersForLogging({}), {});
});

test("redactQueryForLogging: env var names are kept, every value is redacted", () => {
  // A name-pattern denylist would have preserved DATABASE_URL and PATH; the
  // former carries its credential inside the value.
  const env = JSON.stringify({
    PASSWORD: "p",
    PORT: "5432",
    PATH: "/usr/bin",
    DATABASE_URL: "postgres://user:password@host/db",
  });
  const out = redactQueryForLogging({ env, transport: "stdio" }) as Record<
    string,
    unknown
  >;
  assert.deepEqual(out.env, {
    PASSWORD: "***",
    PORT: "***",
    PATH: "***",
    DATABASE_URL: "***",
  });
  assert.equal(out.transport, "stdio");
});

test("redactQueryForLogging: a nested env value is redacted, not descended into", () => {
  const env = JSON.stringify({ SAFE: { PASSWORD: "p" } });
  const out = redactQueryForLogging({ env }) as Record<string, unknown>;
  assert.deepEqual(out.env, { SAFE: "***" });
});

test("redactQueryForLogging: malformed env falls back to ***", () => {
  const out = redactQueryForLogging({ env: "not-json" }) as Record<
    string,
    unknown
  >;
  assert.equal(out.env, "***");
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

test("redactQueryForLogging: env parsing to a non-object is redacted wholesale", () => {
  // An array or a scalar has no env-var names worth preserving.
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

  const nullEnv = JSON.stringify(null);
  assert.equal(
    (redactQueryForLogging({ env: nullEnv }) as Record<string, unknown>).env,
    "***",
  );
});

test("redactQueryForLogging: missing env passes through unchanged", () => {
  assert.deepEqual(redactQueryForLogging({ transport: "sse" }), {
    transport: "sse",
  });
});

test("redactQueryForLogging: a non-object query passes through unchanged", () => {
  assert.equal(redactQueryForLogging(undefined), undefined);
  assert.equal(redactQueryForLogging("nope"), "nope");
});
