# CI Debugging Refactor: Inspector as an Automated MCP Server Debugging Tool

## Goal

Transform the MCP Inspector CLI into a CI-first debugging tool that AI agents (Claude, etc.) can use to programmatically test, validate, and diagnose MCP servers — without a browser UI.

This is **not** another general-purpose MCP client. For interactive command-line use of MCP servers, use [mcpc](https://github.com/apify/mcp-cli). Inspector's CLI is the **debugging companion**: structured diagnostics, batch debugging workflows, and CI-clean semantics.

---

## Current State

The Inspector CLI (`--cli` mode) supports single-method invocations across three transports (stdio, SSE, Streamable HTTP):

| Method                     | Implemented | Tested | Notes                                           |
| -------------------------- | ----------- | ------ | ----------------------------------------------- |
| `tools/list`               | ✓           | ✓      |                                                 |
| `tools/call`               | ✓           | ✓      | Fetches schema first for type coercion (2 RPCs) |
| `resources/list`           | ✓           | ✗      | Zero test coverage                              |
| `resources/read`           | ✓           | stdio  | Only tested over stdio                          |
| `resources/templates/list` | ✓           | ✗      | Zero test coverage                              |
| `prompts/list`             | ✓           | ✓      |                                                 |
| `prompts/get`              | ✓           | ✓      |                                                 |
| `logging/setLevel`         | ✓           | HTTP   | Sets level but discards all log notifications   |
| `ping`                     | ✗           |        |                                                 |
| `discover`                 | ✗           |        |                                                 |
| `completion/complete`      | ✗           |        |                                                 |

**Key architectural limitations:**

1. **One method per process** — each invocation connects, runs one call, disconnects. Stdio servers respawn every time.
2. **No structured output envelope** — raw JSON on stdout, bare strings on stderr. No programmatic error categorization.
3. **Server logs discarded** — debug logging is enabled on connect via `logging/setLevel`, but the `logging/message` notifications are never captured.
4. **No capability gating** — methods are dispatched without checking server capabilities. Failures are ambiguous.
5. **Exit code ambiguity** — server-side errors (`isError: true`) exit 0; only client-side failures exit non-zero. Invisible to CI pipelines using `set -e`.

---

## Differentiation vs. mcpc

| Feature                | mcpc (apify)              | Inspector CLI (this refactor)            |
| ---------------------- | ------------------------- | ---------------------------------------- |
| Primary audience       | Interactive CLI users     | AI agents and CI pipelines               |
| Output format          | Raw MCP JSON (`--json`)   | Structured envelope with diagnostics     |
| Error handling         | Undocumented exit codes   | Typed error taxonomy, `--fail-on-error`  |
| Session model          | Persistent named sessions | One-shot (default) + batch script mode   |
| Capability discovery   | Implicit per-method       | Explicit `discover` command              |
| Server log capture     | ✗                         | ✓ Buffer `logging/message` notifications |
| Sampling/elicitation   | ✗                         | ✓ Reject + capture for inspection        |
| Batch workflows        | Shell scripts             | JSON script with `onError` control flow  |
| CI exit code semantics | ✗                         | ✓ `--fail-on-error`                      |

---

## Design Decisions

### 1. Invocation Model: One-Shot + Batch Script

**Default** remains one-shot (backward compatible): connect, run one method, output result, disconnect.

**New**: `--script <file>` flag accepts a JSON array of operations executed sequentially on a single persistent connection.

```json
[
  { "method": "discover" },
  {
    "method": "tools/call",
    "toolName": "echo",
    "toolArgs": { "message": "hello" },
    "onError": "continue"
  },
  { "method": "resources/list", "onError": "stop" },
  {
    "method": "resources/read",
    "uri": "demo://example",
    "onError": "skip-to:5"
  },
  { "method": "ping" }
]
```

**`onError` control flow** (per step):

| Value         | Behavior                                      |
| ------------- | --------------------------------------------- |
| `"stop"`      | Abort script, return results so far (default) |
| `"continue"`  | Record the error, proceed to next step        |
| `"skip-to:N"` | Jump to step index N on error (0-based)       |

**Rationale**: Claude expresses the whole debugging plan declaratively in one tool call. No shell scripting, no jq parsing between steps.

### 2. Structured Output Envelope

Enabled via `--structured` flag. Raw JSON output remains the default for backward compatibility.

```json
{
  "structuredVersion": 1,
  "success": true,
  "method": "tools/call",
  "durationMs": 234,
  "result": { "content": [{ "type": "text", "text": "Echo: hello" }] },
  "error": null,
  "logs": [
    {
      "level": "debug",
      "message": "tool echo invoked",
      "timestamp": "2026-01-30T12:00:00.000Z"
    }
  ]
}
```

In script mode, the top level becomes an array of these envelopes (one per step).

**Error taxonomy** (mutually exclusive `error.category`):

| Category      | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `transport`   | Could not connect — bad URL, subprocess crash, ECONNREFUSED, timeout |
| `capability`  | Server does not support the requested method                         |
| `protocol`    | Malformed JSON-RPC, handshake failure                                |
| `application` | Tool/resource/prompt returned an error in its content                |
| `validation`  | Client-side failure — missing required arg, bad metadata             |

### 3. Server Log Capture

Register a `logging/message` notification handler on every connection. Buffer all log messages for the session lifetime. Include them in the structured output envelope.

In non-structured mode, emit captured logs to stderr.

**Rationale**: The CLI already enables debug-level logging on connect. Discarding the notifications is an existing bug — fixing it is the single highest-value diagnostic change.

### 4. `discover` Command

A pseudo-method that connects once and returns the full server shape:

```json
{
  "serverInfo": { "name": "my-server", "version": "1.0.0" },
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": false,
    "logging": true,
    "completions": false
  },
  "tools": [...],
  "resources": [...],
  "prompts": []
}
```

Runs: `initialize` → read capabilities → conditionally call `tools/list`, `resources/list`, `prompts/list`. One connection, one output.

### 5. Exit Code Contract

| Flag              | Server `isError: true` | Client validation error | Transport error |
| ----------------- | ---------------------- | ----------------------- | --------------- |
| (default)         | exit 0                 | exit 1                  | exit 1          |
| `--fail-on-error` | exit 1                 | exit 1                  | exit 1          |

**Rationale**: Backward compatible by default. CI pipelines opt into strict semantics explicitly.

### 6. Sampling / Elicitation Policy

Default policy: **reject/decline all** server-initiated requests. The incoming request payloads are captured and included in the structured output envelope so the caller can inspect what the server attempted.

Rationale: No user to approve in a headless tool. Reject is safe. Capture provides visibility.

### 7. Capability Gating

Before dispatching any method, check that the server's `initialize` response advertises the relevant capability. If not, fail immediately with a `capability` category error.

---

## Implementation Phases

### Phase 1 — Debugging Primitives

**New files:**

- `cli/src/output.ts` — Output envelope formatting, error categorization
- `cli/src/discover.ts` — Capability discovery logic

**Modified files:**

- `cli/src/index.ts` — Add `discover` and `ping` methods; add `--structured` and `--fail-on-error` flags; add capability gating before dispatch
- `cli/src/client/connection.ts` — Register `logging/message` notification handler; expose captured logs
- `cli/src/error-handler.ts` — Produce categorized `StructuredError` objects
- `.github/workflows/main.yml` — Add CLI test step (currently only in narrow `cli_tests.yml`)

**New tests:**

- `cli/__tests__/ci-debugging.test.ts` — Covers: `discover`, structured output, log capture, exit codes, `resources/list` (zero coverage today), `resources/templates/list` (zero coverage today), SSE transport success paths

### Phase 2 — Batch Debugging Workflows

**New files:**

- `cli/src/script.ts` — Script parser, validator, and sequential executor with `onError` control flow

**Modified files:**

- `cli/src/index.ts` — Wire `--script` flag into the dispatch path

**New tests:**

- Multi-operation script over stdio
- `onError` control flow (stop, continue, skip-to)
- Malformed script validation

### Phase 3 — Advanced Diagnostics

- Sampling/elicitation capture (reject + include in envelope)
- `completion/complete` subcommand
- `--watch <duration>` notification capture mode

---

## Out of Scope

- Browser-based OAuth flows (require human interaction; use mcpc for these)
- Full MCP server lifecycle management (we connect to servers, not manage them)
- Interactive shell (mcpc does this)
- Performance optimization of the double-RPC in `tools/call`
- Streaming output during long-running tool calls (delivered atomically on completion)

---

## File Layout After Refactor

```
cli/
├── src/
│   ├── cli.ts              # Entry point (unchanged)
│   ├── index.ts            # Main dispatch — refactored with capability gating, new flags
│   ├── transport.ts        # Transport factory (unchanged)
│   ├── error-handler.ts    # Produces StructuredError with category
│   ├── output.ts           # NEW: envelope formatting, structured/raw modes
│   ├── discover.ts         # NEW: capability discovery + list enumeration
│   ├── script.ts           # NEW (Phase 2): script parser and executor
│   └── client/
│       ├── connection.ts   # Log capture via logging/message handler
│       ├── tools.ts        # Unchanged
│       ├── resources.ts    # Unchanged
│       └── prompts.ts      # Unchanged
└── __tests__/
    ├── ci-debugging.test.ts  # NEW: CI-focused coverage
    └── helpers/              # Unchanged
```
