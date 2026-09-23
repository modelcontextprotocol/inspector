---
name: mcpdo
description: Use the mcpdo CLI to connect to Model Context Protocol (MCP) servers and run tools, read resources, list prompts, and more from the command line or from an agent's shell. Use this skill whenever a task requires inspecting, testing, or scripting against an MCP server (stdio or HTTP) rather than writing custom client code.
---

# mcpdo — MCP Inspector connection CLI

Connect to an MCP server once, then run many commands against that named
connection.

```bash
mcpdo connect ./path/to/server.json          # config-file entry
mcpdo connect https://example.com/mcp        # ad-hoc HTTP/SSE target
mcpdo connect node server.js                 # ad-hoc stdio target

mcpdo tools/list
mcpdo tools/call <toolName> arg:=value
mcpdo resources/list
mcpdo resources/read <uri>
mcpdo prompts/list

mcpdo @my-connection tools/list                 # target a specific connection
mcpdo --connection my-connection tools/list

mcpdo disconnect
```

Run `mcpdo help` or `mcpdo <command> --help` for the full, authoritative list of
commands and flags.

## Conventions

- `--format json` outputs JSON; the default, `--format text`, is
  human-readable.
- `mcpdo connections/list` shows open connections; `@name` (prefix on any command)
  or `--connection <name>` (shorthand `--conn`) selects one explicitly when the most-recently-used
  connection isn't the right one.
- A connected connection persists across separate `mcpdo` invocations — no need
  to reconnect before each command. `mcpdo disconnect` ends one connection;
  `mcpdo daemon stop` resets everything.
- `mcpdo connect <name-in-config> --config path/to/mcp.json` connects a
  pre-declared catalog entry (may include auth, headers, protocol-era
  overrides); `mcpdo connect <url-or-command>` connects an ad-hoc target with
  defaults.
- Auth is handled automatically at connect time and stored for reuse (`mcpdo
  auth/list` / `mcpdo auth/clear`); nothing extra is needed for authenticated
  HTTP servers beyond `connect` and completing the browser flow if prompted.
- If a server asks a question mid-call (elicitation), mcpdo prompts
  interactively by default — including over a plain non-TTY stdin, so an
  agent can relay the question and answer it. Only `--format json` (whose
  stdout must stay a single machine-readable payload) auto-declines instead
  of prompting. Pass `--elicit off` on
  `connect` if you want a well-behaved server to fall back to its own
  defaults instead.
