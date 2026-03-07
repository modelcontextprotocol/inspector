# Launcher and config consolidation plan

## Goal

- One **dedicated launcher** package under `launcher/` (implemented in `main.ts` with Commander, built to `build/main.js`) that only chooses which app to run and forwards argv; no config processing in the launcher.
- One **shared config processor** in **core** that turns MCP server/connection options into a **list** of runner configs; all apps use it. Apps pass a **mode** (single- or multi-server) and get back one or more `MCPServerConfig` entries. **All existing config behavior must continue to work:** the processor must honor every supported server-config parameter and merge/override rules (single-server: file then args; multi-server: file only, no overrides).
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

- The **shared config processor** lives in **core** under **`core/mcp/node/`** (existing shared config code and node deps are there). It is a **library**: it does not parse argv and does not display help. Callers (the runners) parse argv and pass in only the server-config subset. **Core does not depend on Commander.**
- **Helper functions:** Core exports **helper functions** used by runners when defining their Commander options—e.g. `parseKeyValuePair` (for `-e KEY=VALUE`) and `parseHeaderPair` (for `--header "Name: Value"`). These are pure functions with no Commander dependency; each runner adds the server-config options to its own Commander program in place (some duplication of the `.option()` chain across web, CLI, TUI is accepted for clarity). Runners use these helpers as the option coerce/accumulator where applicable.
- **Input:** A structured object of MCP server/connection options (e.g. config path + server name, or command/URL + transport, plus cwd, env, headers, etc.), plus a **mode** flag: **single-server** or **multi-server**. Core exports a **TypeScript type** for this options object so runners can type the parsed subset they pass in.
- **Output:** A **list** of **`MCPServerConfig`** (the existing type in core). Length is 1 for single-server mode; 1 or more for multi-server mode depending on config.
- **Behavior (single-server mode):** Used by CLI and Web. If an MCP config file (and optional server name) is provided, load that server from the file, then **override** with any options from the args (args win). If no config file is provided, build one server config from the options object only (ad-hoc command/URL + transport, etc.). Returns a list of one element. All existing single-server behavior is preserved.
- **Behavior (multi-server mode):** Used by TUI (and potentially Web later). TUI can handle multiple servers, so it always passes multi-server mode; the processor returns one or more configs according to the options. When a **config path is provided**: load the file and return all servers; **error** if the caller also provides `--transport`, `--server-url`, or any positional args (command/URL), since those are ambiguous. **Allowed overrides** when config path is provided: `-e` (env), `--cwd`, and `--header`. These apply to **all** servers where applicable—env and cwd override stdio servers only; headers override all HTTP/SSE transports (merged with per-server headers). When **no** config path is provided, build a single-element list from ad-hoc options (command/URL + transport, etc.) as in single-server.
- **Server-config parameters** (the processor accepts these when provided by the caller; the processor does not read argv itself): `--config` / config path, `--server` / server name; `-e` KEY=VALUE (env), `--transport`, `--server-url`, `--cwd`, `--header`; positional / args after `--` (command and args for stdio).
- **App-specific options** (e.g. `--dev`, `--method`, `--tool-name`) are **not** passed to the processor. Each runner parses argv, extracts the server-config subset, calls the processor with the appropriate mode, and handles its own options and help. If an app receives a param that does not apply (e.g. `--method` for web or TUI), that app treats it as an error.
- **Web** may evolve to accept multiple servers in the future; the same core processor with multi-server mode would support that without changing the shared API.

### 3. Runners: each app owns parsing, config, and help

- Each app (web, CLI, TUI) exposes a **runner** function that accepts **argv** (e.g. `runWeb(argv)`, `runCli(argv)`, `runTui(argv)`). The runner is the single code path for that app whether it is invoked from the launcher or from the app's own entrypoint.
- **Each runner:** Builds a Commander program and defines server-config options **in place** (each app has its own `.option()` chain for `--config`, `--server`, `-e`, `--transport`, `--server-url`, `--cwd`, `--header`, etc.; duplication accepted). Uses **helper functions** from core (e.g. `parseKeyValuePair`, `parseHeaderPair`) where applicable. Adds that app's own options (e.g. `--dev`, `--method`). Parses argv, handles `-h`/`--help` for that app, extracts the server-config subset from the parsed result, calls the **core config processor** with that subset **and the appropriate mode** (single-server for Web and CLI; multi-server for TUI—TUI can handle multiple, so it always passes multi; the processor returns one or more configs accordingly), gets back a **list** of `MCPServerConfig`, then runs the app with that list (Web/CLI use the single element; TUI uses the full list) plus any app-specific options (e.g. `--dev`, `--method`).
- Examples: `mcp-inspector --cli -h` → launcher invokes CLI runner with argv; CLI runner sees `-h` and prints CLI help. `mcp-inspector --cli --config mcp.json --server demo --method tools/list` → launcher invokes CLI runner with argv; CLI runner parses everything, calls core processor in single-server mode, gets one config, runs tools/list. `mcp-inspector --tui --config mcp.json` → TUI runner calls processor in multi-server mode, gets all servers from file. `mcp-inspector-cli --config mcp.json -h` (direct) → app entrypoint calls `runCli(process.argv)`; same behavior. No spawn: when the launcher runs an app, it is the same process.
- **Signals and exit codes:** The launcher runs apps in-process (no child process), so there is no signal forwarding or child-exit handling. The **runner** is responsible for signal handling and cleanup (e.g. SIGINT to shut down the server). The launcher and each app's `index.js` only call the runner and exit with the runner's exit code (or 1 on thrown error). Document expected exit codes for each runner (e.g. 0 success, 1 usage/error) so the launcher and callers can rely on them.

### 4. Direct launch and entrypoints

- Each app has a **single, consistently named entrypoint: `index.js`** under **`build/`**, matching the CLI/TUI pattern. So: `web/build/index.js`, `cli/build/index.js`, `tui/build/index.js`. The launcher and package `bin` fields point at these. This avoids mixed names (start, index, tui) and keeps `index.js` as the standard entrypoint name across apps.
- The entrypoint is a thin wrapper: it calls the app's runner with `process.argv` (e.g. `runWeb(process.argv)`).
- Direct launch and launcher-invoked launch use the **same** runner code; the only difference is whether the process was started by the user running the app binary or by the launcher calling the runner. Behavior is identical.

### 5. Summary

| Component            | Location                                                                                       | Responsibility                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Launcher**         | **`launcher/`** package (`src/main.ts`, Commander, build → `build/main.js`)                    | Parse only `--web`/`--cli`/`--tui` and `-h`. Show launcher help (mode options only). Call `runWeb(argv)` / `runCli(argv)` / `runTui(argv)` in-process. No config processing. Root `bin` points to `launcher/build/main.js`.                                |
| **Config processor** | **Core** (`core/mcp/node/`)                                                                    | Library: **helper functions** (e.g. `parseKeyValuePair`, `parseHeaderPair`) for option parsing; `resolveServerConfigs(options, mode)` returns **list** of `MCPServerConfig`. No Commander in core; each runner defines its own Commander options in place. |
| **Runners**          | **Web** (`web/`), **CLI** (`cli/`), **TUI** (`tui/`)                                           | Parse argv, show app help, call core config processor with server-config subset and mode, get list of configs, run app. Same behavior when called from launcher or from app entrypoint.                                                                    |
| **App entrypoints**  | **`index.js`** per app (e.g. `web/build/index.js`, `cli/build/index.js`, `tui/build/index.js`) | Thin wrapper: call runner with `process.argv`.                                                                                                                                                                                                             |

### 6. Phasing

1. **Core config module**  
   In core (no Commander dependency): (a) **Helper functions** — export pure functions used by runners when defining Commander options, e.g. `parseKeyValuePair` (for `-e KEY=VALUE`) and `parseHeaderPair` (for `--header "Name: Value"`). Runners use these as option coerce/accumulator in their own `.option()` chains. (b) **Config processor** — `resolveServerConfigs(options, mode)` that accepts the structured options object (typed; core exports the options type) and a **mode** (`'single'` | `'multi'`), and returns a **list** of **`MCPServerConfig`**. Single mode: one entry (from file + overrides, or from args only). Multi mode with config path: load all servers from file; error if transport, server-url, or positional args are also provided; allow env, cwd, and headers as overrides (env/cwd for stdio servers, headers for HTTP/SSE). Multi mode without config path: single-element list from args. Deprecate/remove duplicate `argsToMcpServerConfig` in CLI.

2. **Web runner**  
   Refactor so that `runWeb(argv)` is the main API: it parses argv with Commander, calls core config processor with server-config subset and single-server mode, gets list of one config, handles `--dev` and `-h`, then runs. Entrypoint **`index.js`** (e.g. `web/build/index.js`) just calls `runWeb(process.argv)`.

3. **CLI runner**  
   Refactor so that `runCli(argv)` is the main API: parses argv with Commander, calls core config processor with single-server mode, gets list of one config, handles `--method`, `-h`, etc., then runs. Entrypoint **`index.js`** calls `runCli(process.argv)`.

4. **TUI runner**  
   TUI already exports `runTui(args?)`; ensure it accepts argv and parses with Commander. It adopts the same server-config options as the other apps (e.g. `--config` instead of only a positional config path) and always calls core config processor with **multi-server** mode (processor returns all from file or a single-element list from args). Entrypoint **`index.js`** calls `runTui(process.argv)`.

5. **Launcher package (`launcher/`)**  
   Add a new workspace **`launcher/`** with `src/main.ts` using Commander to parse **only** `--web`/`--cli`/`--tui` and `-h`. Show launcher help for `mcp-inspector -h` (only those mode options). Dynamic import of the chosen app and call the exported runner with argv: `runWeb(process.argv)` / `runCli(process.argv)` / `runTui(process.argv)`. No config processing; no spawn. Build to `launcher/build/main.js`; root package `bin` for `mcp-inspector` points to that file. Launcher package has Commander as a dependency.

6. **Entrypoints and direct launch**  
   Standardize app entrypoints to **`build/index.js`** for all apps (same as CLI/TUI): add or move web to `web/build/index.js`, ensure `cli/build/index.js` and `tui/build/index.js` (rename `tui/build/tui.js` → `tui/build/index.js`). Update root and workspace `package.json` `bin` fields, scripts (e.g. `npm run dev`), and launcher to point at these paths. Each app's binary points at its `index.js`; direct run behaves identically to launcher-invoked run.

---

## References

- Launcher: `cli/src/cli.ts` (parseArgs, loadConfigFile, runWeb, runCli, runTui).
- Web entry: `web/bin/start.js` (argv parsing, startDevClient / startProdClient).
- CLI entry: `cli/src/index.ts` (parseArgs, argsToMcpServerConfig, callMethod).
- TUI entry: `tui/tui.tsx` (runTui, Commander for config file + options). After consolidation: entrypoint `tui/build/index.js`.
- Core config: `core/mcp/node/config.ts` (loadMcpServersConfig, argsToMcpServerConfig).
- Todo: `docs/inspector-client-todo.md` (Misc: "Look at the launcher flow… Single launcher just routes to app…").
