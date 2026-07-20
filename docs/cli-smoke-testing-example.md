# CLI Smoke Testing for MCP Servers

This guide shows how to use the MCP Inspector in [CLI mode](../README.md#cli-mode) to run lightweight smoke tests against an MCP server. The method is generic and works with any MCP server that exposes a stdio, SSE, or Streamable HTTP transport. A couple of concrete servers are used as examples, but you can substitute your own.

CLI mode prints structured JSON to stdout and uses a non-zero exit code on failure, which makes it straightforward to drive from a shell script or a CI job.

## When to use this

- Verifying that a server starts and advertises the expected tools, resources, and prompts.
- Confirming that a representative tool call returns a well-formed response.
- Catching regressions in the tool manifest or transport layer before merging changes.
- Asserting that outputs do not leak sensitive content.

This is a smoke test, not a substitute for unit tests. It checks the wiring end to end without covering every code path.

## Prerequisites

- Node.js `^22.7.5` (see the root [README](../README.md)).
- The MCP Inspector CLI, available via `npx @modelcontextprotocol/inspector`.
- [`jq`](https://jqlang.github.io/jq/) (optional) for JSON assertions in shell scripts.
- A built MCP server you can launch with a single command.

## The smoke test workflow

Every smoke test follows the same four steps:

1. **Connect** — launch the server (stdio) or point the CLI at a URL (SSE / Streamable HTTP).
2. **List** — enumerate tools, resources, or prompts and assert the expected entries are present.
3. **Call** — invoke one representative tool with safe arguments and assert the response shape.
4. **Assert safe output** — confirm the response does not contain secrets or blocked content.

The CLI exits with code `0` on success and `1` on error, so a failing assertion or a server error fails the step.

### Supported methods

The `--method` flag accepts:

| Method                     | Required options                                    |
| -------------------------- | --------------------------------------------------- |
| `tools/list`               | none                                                |
| `tools/call`               | `--tool-name`, optional `--tool-arg key=value`      |
| `resources/list`           | none                                                |
| `resources/read`           | `--uri <uri>`                                       |
| `resources/templates/list` | none                                                |
| `prompts/list`             | none                                                |
| `prompts/get`              | `--prompt-name`, optional `--prompt-args key=value` |
| `logging/setLevel`         | `--log-level <level>`                               |

Run `npx @modelcontextprotocol/inspector --cli --help` to see the full set of options.

## Example 1: reference `server-everything`

The [`@modelcontextprotocol/server-everything`](https://github.com/modelcontextprotocol/servers) reference server is a convenient target because it runs anywhere with `npx` and requires no configuration.

```bash
INSPECTOR="npx @modelcontextprotocol/inspector --cli"

# 1. List tools and confirm the manifest is non-empty.
$INSPECTOR npx @modelcontextprotocol/server-everything --method tools/list > tools.json
jq '.tools | length' tools.json           # expect > 0
jq '.tools[].name' tools.json | grep -q '^echo$'

# 2. Call the `echo` tool and assert the response.
$INSPECTOR npx @modelcontextprotocol/server-everything \
  --method tools/call --tool-name echo --tool-arg message=smoke > echo.json
jq '.content[0].text' echo.json           # expect the echoed message
```

If any command exits non-zero or the `jq` assertion finds no match, the smoke test fails.

## Example 2: a local stdio server (PatchWarden)

The same workflow applies to any local MCP server built to a `dist/index.js` entry point. [PatchWarden](https://github.com/jiezeng2004-design/PatchWarden) is used here as one real-world example; substitute your own server command and tool names as needed.

```bash
INSPECTOR="npx @modelcontextprotocol/inspector --cli"
SERVER="node dist/index.js"

# 1. List tools and assert a known tool is advertised.
$INSPECTOR $SERVER --method tools/list > tools.json
jq '.tools[].name' tools.json | grep -q '^health_check$'

# 2. Call a safe, read-only tool and assert the response shape.
$INSPECTOR $SERVER --method tools/call --tool-name health_check > health.json
jq '.content[0].text | fromjson | .status' health.json   # expect a status string
```

Environment variables are passed with `-e` (repeated for each variable), which is useful for servers that read configuration from the environment:

```bash
$INSPECTOR -e PATCHWARDEN_CONFIG=/path/to/config.json $SERVER --method tools/list
```

## Asserting safe output

A smoke test should also confirm that outputs do not leak sensitive content. Two complementary checks are useful:

1. **Block-list check** — assert the response text does not contain known secret patterns (tokens, private keys, `.env` contents).
2. **Server-side guard** — for servers that gate access to sensitive paths, call the tool that reads files and assert it refuses a sensitive target.

The second check is server-specific. PatchWarden, for example, exposes a `read_workspace_file` tool that rejects sensitive filenames such as `.env`. The smoke test asserts the refusal rather than the content:

```bash
# The server should return an error (isError: true), not the file contents.
$INSPECTOR $SERVER --method tools/call --tool-name read_workspace_file \
  --tool-arg path=.env > read.json
jq -e '.isError == true' read.json        # -e exits non-zero if the assertion fails
```

For a generic block-list check on any tool response, scan the serialized output for patterns that must never appear in a safe response:

```bash
# Fail if the response looks like it contains a secret.
jq -r '.content[]?.text // empty' health.json \
  | grep -Ei '(sk-[a-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----|AKIA[0-9A-Z]{16})' \
  && { echo "sensitive content detected"; exit 1; } || true
```

Adjust the regular expression to the secret formats relevant to your environment. Treat this as defence in depth, not a substitute for keeping secrets out of server output in the first place.

## Remote servers (SSE / Streamable HTTP)

The same methods work against a running remote server. The transport is auto-detected from the URL (`/sse` → SSE, `/mcp` → Streamable HTTP) or set explicitly with `--transport`:

```bash
# Streamable HTTP (auto-detected from the /mcp path).
$INSPECTOR https://example.com/mcp --method tools/list

# SSE, with a custom authentication header.
$INSPECTOR https://example.com/sse --transport sse \
  --method tools/list --header "Authorization: Bearer $TOKEN"
```

For smoke tests against authenticated endpoints, provide the token through an environment variable so it is not recorded in the command history or CI logs.

## A minimal smoke test script

Putting the pieces together, a minimal shell script for a local stdio server:

```bash
#!/usr/bin/env bash
set -euo pipefail

INSPECTOR="npx @modelcontextprotocol/inspector --cli"
SERVER="node dist/index.js"

# tools/list is non-empty and advertises health_check.
$INSPECTOR $SERVER --method tools/list > tools.json
jq -e '.tools | length > 0' tools.json >/dev/null
jq -e '.tools[].name | select(. == "health_check")' tools.json >/dev/null

# tools/call returns a well-formed response.
$INSPECTOR $SERVER --method tools/call --tool-name health_check > health.json
jq -e '.content[0].text != null' health.json >/dev/null

# Sensitive path access is refused.
$INSPECTOR $SERVER --method tools/call --tool-name read_workspace_file \
  --tool-arg path=.env > read.json
jq -e '.isError == true' read.json >/dev/null

# No obvious secret patterns in any captured output.
for f in tools.json health.json read.json; do
  if grep -Ei '(sk-[a-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----)' "$f"; then
    echo "sensitive content detected in $f" >&2
    exit 1
  fi
done

echo "smoke test passed"
```

## Running in CI

Because the CLI returns a non-zero exit code on failure, the script above drops into a CI step with no wrapper:

```yaml
# GitHub Actions example
- name: MCP smoke test
  run: |
    npm run build
    bash scripts/mcp-smoke.sh
```

Pin the Inspector version in CI (for example `npx @modelcontextprotocol/inspector@0.22.0 --cli ...`) so a future release does not silently change the output format your assertions rely on.
