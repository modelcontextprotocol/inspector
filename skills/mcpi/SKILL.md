---
name: mcpi
description: Use the mcpi CLI to connect to Model Context Protocol (MCP) servers and run tools, read resources, list prompts, and more from the command line or from an agent's shell. Use this skill whenever a task requires inspecting, testing, or scripting against an MCP server (stdio or HTTP) rather than writing custom client code.
---

# mcpi — MCP Inspector session CLI

Connect to an MCP server once, then run many commands against that named
session.

```bash
mcpi connect ./path/to/server.json          # config-file entry
mcpi connect https://example.com/mcp        # ad-hoc HTTP/SSE target
mcpi connect node server.js                 # ad-hoc stdio target

mcpi tools/list
mcpi tools/call <toolName> arg:=value
mcpi resources/list
mcpi resources/read <uri>
mcpi prompts/list

mcpi @my-session tools/list                 # target a specific session
mcpi --session my-session tools/list

mcpi disconnect
```

Run `mcpi help` or `mcpi <command> --help` for the full, authoritative list of
commands and flags.

## Conventions

- `--format json` outputs JSON; the default, `--format text`, is
  human-readable.
- `mcpi sessions/list` shows open sessions; `@name` (prefix on any command)
  or `--session <name>` selects one explicitly when the most-recently-used
  session isn't the right one.
- A connected session persists across separate `mcpi` invocations — no need
  to reconnect before each command. `mcpi disconnect` ends one session;
  `mcpi daemon stop` resets everything.
- `mcpi connect <name-in-config> --config path/to/mcp.json` connects a
  pre-declared catalog entry (may include auth, headers, protocol-era
  overrides); `mcpi connect <url-or-command>` connects an ad-hoc target with
  defaults.
- Auth is handled automatically at connect time and stored for reuse (`mcpi
  auth/list` / `mcpi auth/clear`); nothing extra is needed for authenticated
  HTTP servers beyond `connect` and completing the browser flow if prompted.
- If a server asks a question mid-call (elicitation), mcpi prompts
  interactively by default; running non-interactively (no TTY, scripted, or
  `--format json`) auto-declines instead of hanging. Pass `--elicit off` on
  `connect` if you want a well-behaved server to fall back to its own
  defaults instead.
