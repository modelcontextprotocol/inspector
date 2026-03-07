# Launcher and config consolidation plan

## Goal

- One **dedicated launcher** package under `launcher/` (implemented in `main.ts` with Commander, built to `build/main.js`) that only chooses which app to run and forwards argv; no config processing in the launcher.
- One **shared config processor** in **core** that turns MCP server/connection options into a runner config; all apps use it. **All existing config behavior must continue to work:** the processor must honor every supported server-config parameter.
- Each app (web, CLI, TUI) exposes a **runner** that accepts argv, does its own parsing and help, calls the shared processor for server config, and runs. Same behavior when invoked from the launcher or directly.

---

## Current behavior

### Entrypoints

| User runs                                | What executes                                        | Config handling                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `mcp-inspector` (or `npm run web`)       | `node cli/build/cli.js` (launcher)                   | Launcher parses argv, does `--config` / `--server` / mcp.json handling                                                     |
| `mcp-inspector --web`                    | Same launcher → **spawns** `node web/bin/start.js`   | Launcher resolves config to Args, passes as CLI flags to child                                                             |
| `mcp-inspector --cli`                    | Same launcher → **spawns** `node cli/build/index.js` | Launcher resolves config to command+args+transport+cwd, passes as argv to child                                            |
| `mcp-inspector --tui`                    | Same launcher → **spawns** `node tui/build/tui.js`   | **No** launcher config: raw `process.argv.slice(2)` passed to TUI; TUI parses its own config file path and options         |
| `npm run dev`                            | `node web/bin/start.js --dev`                        | **No** launcher; web parses argv only (no `--config`/`--server`), so no mcp.json unless you pass equivalent flags manually |
| `mcp-inspector-web` (from web workspace) | `node web/bin/start.js`                              | Same as above                                                                                                              |
| `mcp-inspector-tui` (from TUI workspace) | `node tui/build/tui.js`                              | TUI parses argv; expects config file path and options                                                                      |
| `mcp-inspector-cli` (from CLI workspace) | `node cli/build/index.js`                            | CLI parses argv; expects target (URL or command) + method flags; **no** `--config`/`--server`                              |

So:

- **Config from mcp.json** is only done in the launcher (`cli/src/cli.ts`): `loadConfigFile(configPath, serverName)` returns a single `ServerConfig`; `parseArgs()` then **merges that with all supported CLI options** (e.g. `--cwd`, `-e`, `--header`, args after `--`) and produces `Args` (command, args, transport, serverUrl, cwd, envArgs, etc.). So existing behavior is: file supplies base config; every supported param can override or extend it.
- **Web** never sees `--config` or `--server`; it receives the **resolved** params (e.g. `--transport stdio --cwd /path -- node script.js`). Web's `start.js` parses those flags and env (e.g. `MCP_INITIAL_*`) and passes a config object into the dev or prod client.
- **CLI (inspector-cli)** when spawned gets the same resolved target (command + args) as its positional arguments, plus `--transport`, `--cwd`, etc. It uses its own `parseArgs()` and `argsToMcpServerConfig()` (duplicated logic vs core's `argsToMcpServerConfig` in `core/mcp/node/config.ts`) to build `MCPServerConfig`.
- **TUI** does not use the launcher's config at all when started via `mcp-inspector --tui`; it gets raw argv and requires a config **file path** and supports multiple servers from that file via core's `loadMcpServersConfig()`.

### Problems with the current design

1. **Two processes for web and CLI**  
   Launcher spawns `node web/bin/start.js` or `node cli/build/index.js`. That means extra process overhead, harder debugging, and serialization of config via argv/env instead of passing a config object.

2. **Config logic is split and duplicated**
   - Launcher: custom `loadConfigFile(configPath, serverName)` and `parseArgs()` that understand `--config`/`--server`, single-server only.
   - Core: `loadMcpServersConfig(configPath)` (full file) and `argsToMcpServerConfig(args)` (target + transport → `MCPServerConfig`).
   - CLI (index.ts): its own `argsToMcpServerConfig()` (duplicate of core's).
   - TUI: uses core's `loadMcpServersConfig`; different UX (config file path + multi-server).
   - Web: no config file support; only resolved params via argv/env.

3. **Direct launch is inconsistent**
   - `npm run dev` or `mcp-inspector-web` cannot use `--config mcp.json --server demo`; they'd need to be extended to accept those flags and do the same resolution, or users must use the launcher.
   - So "use one entrypoint" vs "run web (or TUI) directly" are at odds: direct run doesn't get launcher's config handling unless we duplicate or share it.

4. **TUI is a special case**  
   TUI expects a **file path** and multiple servers; launcher is single-server and doesn't pass config file to TUI when using `--tui`. So `mcp-inspector --tui ./mcp.json` would pass `./mcp.json` as a raw arg; TUI would parse it. But launcher's `--config`/`--server` flow (resolve one server from file) is never used for TUI—the comment in code says "we'll integrate config later."

---

## Design

### 1. Launcher: dedicated package under `launcher/`

- A **dedicated launcher package** lives under **`launcher/`** (new workspace, same pattern as `cli/`, `web/`, `tui/`). It is implemented in **`launcher/src/main.ts`** using **Commander** for argument parsing. The package has a build step that compiles to e.g. `launcher/build/main.js`; the root package `bin` for `mcp-inspector` points to that file.
- **Responsibility:** Only to choose which app runs and to forward argv. The launcher:
  - Parses argv **only** to detect `--web`, `--cli`, or `--tui` (default when none specified, e.g. `--web`).
  - If `-h` or `--help` is present and no mode flag is set, prints launcher help and exits. Launcher help shows **only** the mode options (`--web`, `--cli`, `--tui`) and a note that all other arguments are forwarded to the selected app.
  - Does **not** parse, document, or process `--config`, `--server`, or any other server-config or app-specific options.
  - Imports the chosen app package and calls its runner with **argv** in-process: `runWeb(process.argv)`, `runCli(process.argv)`, or `runTui(process.argv)`. No subprocess spawn.
- The launcher does **not** call the shared config processor. Config processing is done only inside the runners.

### 2. Core: shared config processor

- The **shared config processor** lives in **core** (e.g. `core/config/` or under `core/mcp/node/`). It is a **library**: it does not parse argv and does not display help. Callers (the runners) parse argv and pass in only the server-config subset.
- **Input:** A structured object of MCP server/connection options (e.g. config path + server name, or command/URL + transport, plus cwd, env, headers, etc.).
- **Output:** A single **`MCPServerConfig`** (the existing type in core that describes how to connect to one MCP server: transport, command/args or serverUrl, cwd, env, headers).
- **Behavior:** When config file + server are provided, load the file, resolve the named server, and merge with any overrides from the options object (CLI overrides win). When no file is provided, build runner config from the options object only (ad-hoc command/URL + transport, etc.). All existing config behavior is preserved.
- **Server-config parameters** (the processor accepts these when provided by the caller; the processor does not read argv itself): `--config` / config path, `--server` / server name; `-e` KEY=VALUE (env), `--transport`, `--server-url`, `--cwd`, `--header`; positional / args after `--` (command and args for stdio).
- **App-specific options** (e.g. `--dev`, `--method`, `--tool-name`) are **not** passed to the processor. Each runner parses argv, extracts the server-config subset, calls the processor, and handles its own options and help. If an app receives a param that does not apply (e.g. `--method` for web or TUI), that app treats it as an error.

### 3. Runners: each app owns parsing, config, and help

- Each app (web, CLI, TUI) exposes a **runner** function that accepts **argv** (e.g. `runWeb(argv)`, `runCli(argv)`, `runTui(argv)`). The runner is the single code path for that app whether it is invoked from the launcher or from the app's own entrypoint.
- **Each runner:** Parses argv (Commander or equivalent), handles `-h`/`--help` for **that app** (shows that app's full option list including server-config and app-specific options), extracts the server-config subset, calls the **core config processor** with that subset to get `MCPServerConfig`, then runs the app with that config plus any app-specific options (e.g. `--dev`, `--method`).
- Examples: `mcp-inspector --cli -h` → launcher invokes CLI runner with argv; CLI runner sees `-h` and prints CLI help. `mcp-inspector --cli --config mcp.json --server demo --method tools/list` → launcher invokes CLI runner with argv; CLI runner parses everything, calls core processor for server config, runs tools/list. `mcp-inspector-cli --config mcp.json -h` (direct) → app entrypoint calls `runCli(process.argv)`; same behavior. No spawn: when the launcher runs an app, it is the same process.

### 4. Direct launch

- Each app continues to have its own entrypoint (e.g. `web/bin/start.js`, `cli/build/index.js`, `tui/build/tui.js`). The entrypoint is a thin wrapper: it calls the app's runner with `process.argv` (e.g. `runWeb(process.argv)`).
- Direct launch and launcher-invoked launch use the **same** runner code; the only difference is whether the process was started by the user running the app binary or by the launcher calling the runner. Behavior is identical.

### 5. Summary

| Component            | Location                                                                    | Responsibility                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Launcher**         | **`launcher/`** package (`src/main.ts`, Commander, build → `build/main.js`) | Parse only `--web`/`--cli`/`--tui` and `-h`. Show launcher help (mode options only). Call `runWeb(argv)` / `runCli(argv)` / `runTui(argv)` in-process. No config processing. Root `bin` points to `launcher/build/main.js`. |
| **Config processor** | **Core** (`core/config/` or `core/mcp/node/`)                               | Library: accept structured server-config options, return `MCPServerConfig`. No argv parsing, no help. Used only by runners.                                                                                                 |
| **Runners**          | **Web** (`web/`), **CLI** (`cli/`), **TUI** (`tui/`)                        | Parse argv, show app help, call core config processor with server-config subset, run app. Same behavior when called from launcher or from app entrypoint.                                                                   |
| **App entrypoints**  | Same (e.g. `web/bin/start.js`, `cli/build/index.js`, `tui/build/tui.js`)    | Thin wrapper: call runner with `process.argv`.                                                                                                                                                                              |

### 6. Phasing

1. **Core config module**  
   Add (or extend) a layer in core: e.g. `resolveServerConfig(options)` that accepts a structured object of server-config options (parsed by the caller from argv) and returns a single **`MCPServerConfig`** (the type already used by InspectorClient and transports). Deprecate/remove duplicate `argsToMcpServerConfig` in CLI in favor of this shared processor.

2. **Web runner**  
   Refactor so that `runWeb(argv)` is the main API: it parses argv, calls core config processor for the server-config subset, handles `--dev` and `-h`, then runs. Entrypoint `web/bin/start.js` just calls `runWeb(process.argv)`.

3. **CLI runner**  
   Refactor so that `runCli(argv)` is the main API: parses argv, calls core config processor for server config, handles `--method`, `-h`, etc., then runs. Entrypoint calls `runCli(process.argv)`.

4. **TUI runner**  
   TUI already exports `runTui(args?)`; ensure it accepts argv and does its own parsing and core config processor use where applicable. Entrypoint calls `runTui(process.argv)`.

5. **Launcher package (`launcher/`)**  
   Add a new workspace **`launcher/`** with `src/main.ts` using Commander to parse **only** `--web`/`--cli`/`--tui` and `-h`. Show launcher help for `mcp-inspector -h` (only those mode options). Dynamic import of the chosen app and call `runWeb(process.argv)` / `runCli(process.argv)` / `runTui(process.argv)`. No config processing; no spawn. Build to `launcher/build/main.js`; root package `bin` for `mcp-inspector` points to that file. Launcher package has Commander as a dependency.

6. **Direct launch**  
   Each app's binary already calls its runner with argv, so direct run (e.g. `mcp-inspector-web`, `mcp-inspector-cli`) behaves identically to launcher-invoked run.

---

## Open questions

- **TUI multi-server:** TUI currently uses a full config file and multiple servers. Launcher is single-server. Do we want launcher to support "launch TUI with this one server from mcp.json" (same as web/CLI) or always pass through to TUI's own multi-server UX (config file path)?
- **Packaging:** With in-process require, the root package (or launcher package) must depend on web, CLI, and TUI (or have a way to load them). Today's workspace layout already has them; we need to ensure the launcher can import the runners (e.g. from `@modelcontextprotocol/inspector-web`, `@modelcontextprotocol/inspector-cli`, `@modelcontextprotocol/inspector-tui` or relative paths in monorepo).
- **Exit codes and signals:** When the launcher runs web in-process, the web process _is_ the launcher; SIGINT etc. are handled by one process. That can simplify cleanup. We should document expected exit codes for each runner.

---

## References

- Launcher: `cli/src/cli.ts` (parseArgs, loadConfigFile, runWeb, runCli, runTui).
- Web entry: `web/bin/start.js` (argv parsing, startDevClient / startProdClient).
- CLI entry: `cli/src/index.ts` (parseArgs, argsToMcpServerConfig, callMethod).
- TUI entry: `tui/tui.tsx` (runTui, Commander for config file + options).
- Core config: `core/mcp/node/config.ts` (loadMcpServersConfig, argsToMcpServerConfig).
- Todo: `docs/inspector-client-todo.md` (Misc: "Look at the launcher flow… Single launcher just routes to app…").
