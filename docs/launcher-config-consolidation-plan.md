# Launcher and config consolidation plan

## Phase 1 status: **Complete**

Phase 1 is implemented per the design below. Each app has a **small entrypoint** in **`index.ts`** (is-main check + call runner) and a **runner** in **`web.ts`** / **`cli.ts`** / **`tui.tsx`** (Commander, core config, app logic). The launcher calls runners in-process with argv; entrypoints only call `runWeb(process.argv)` / `runCli(process.argv)` / `runTui(process.argv)`. All apps use the shared core config processor. Obsolete `web/bin/start.js` has been removed. Launcher: `launcher/src/index.ts` → `launcher/build/index.js`; root `bin` for `mcp-inspector` points there.

---

## Goal

- One **dedicated launcher** package under `launcher/` (implemented in `main.ts` with Commander, built to `build/main.js`) that only chooses which app to run and forwards argv; no config processing in the launcher.
- One **shared config processor** in **core** that turns MCP server/connection options into a **list** of runner configs; all apps use it. Apps pass a **mode** (single- or multi-server) and get back one or more `MCPServerConfig` entries. **All existing config behavior must continue to work:** the processor must honor every supported server-config parameter and merge/override rules (single-server: file then args; multi-server: file only, no overrides).
- Each app (web, CLI, TUI) exposes a **runner** that accepts argv, does its own parsing and help, calls the shared processor for server config, and runs. Same behavior when invoked from the launcher or directly.

---

## Current behavior

### Entrypoints

| User runs                                | What executes                                                         | Config handling                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `mcp-inspector` (or `npm run web`)       | `node launcher/build/index.js` (default: web)                         | Launcher forwards argv to web runner; web runner parses and uses core config                                  |
| `mcp-inspector --web`                    | Launcher → **in-process** `runWeb(process.argv)` (web/build/index.js) | Launcher resolves config to Args, passes argv to web runner                                                   |
| `mcp-inspector --cli`                    | Launcher → **in-process** `runCli(process.argv)` (cli/build/index.js) | CLI runner parses argv, calls core config processor (single-server), runs method                              |
| `mcp-inspector --tui`                    | Launcher → **in-process** `runTui(process.argv)` (tui/build/index.js) | TUI runner parses argv, calls core config processor (multi-server) or getNamedServerConfigs, runs TUI         |
| `npm run dev`                            | `vite --port 6274` (web package script)                               | **No** launcher; Vite only. For full argv/config use launcher or `node web/build/index.js --dev --config ...` |
| `mcp-inspector-web` (from web workspace) | `node web/build/index.js`                                             | Web entrypoint: runWeb(process.argv) with Commander and core config                                           |
| `mcp-inspector-tui` (from TUI workspace) | `node tui/build/index.js`                                             | Same as launcher path: runTui(process.argv); Commander + core config (--config, multi-server)                 |
| `mcp-inspector-cli` (from CLI workspace) | `node cli/build/index.js`                                             | Same as launcher path: runCli(process.argv); Commander + core config (--config, --server, single-server)      |

So (after Phase 1):

- **Config** is done in **each runner** via **core**: web, CLI, and TUI each parse argv with Commander, extract the server-config subset, and call core's `resolveServerConfigs(options, mode)` (or TUI's `getNamedServerConfigs` when using a config file for multiple named servers). Single-server mode for web and CLI; multi-server for TUI. No config logic in the launcher.
- **Web** runner (`web/src/web.ts`) parses `--config`, `--server`, `-e`, `--transport`, `--server-url`, `--cwd`, `--header`, `--dev`, and positionals; calls core in single-server mode; then spawns Vite (dev) or Hono (prod) with env vars.
- **CLI** runner (`cli/src/cli.ts`) parses the same server-config options plus `--method`, etc.; calls core `resolveServerConfigs(..., "single")`; no duplicate `argsToMcpServerConfig` (removed).
- **TUI** runner (`tui/tui.tsx`) parses `--config`, ad-hoc options, OAuth options; uses core `getNamedServerConfigs` or `resolveServerConfigs(..., "multi")`; passes configs to App as props.

### Problems addressed by Phase 1 (historical)

1. ~~**Two processes for web and CLI**~~  
   **Fixed:** Launcher calls app runners in-process (runWeb/runCli/runTui with argv). No spawn.

2. ~~**Config logic is split and duplicated**~~  
   **Fixed:** Core provides `resolveServerConfigs`, helpers (`parseKeyValuePair`, `parseHeaderPair`), and `ServerConfigOptions`. Web, CLI, and TUI each use core; CLI duplicate `argsToMcpServerConfig` removed.

3. ~~**Direct launch is inconsistent**~~  
   **Fixed:** Direct run (e.g. `mcp-inspector-web --config mcp.json --server demo`) uses the same runner as launcher; each app's entrypoint is a thin wrapper that calls the runner with `process.argv`.

4. ~~**TUI is a special case**~~  
   **Fixed:** TUI runner accepts same `--config` and server-config options, calls core in multi-server mode (or `getNamedServerConfigs` for named servers from file).

---

## Design

### 1. Launcher: dedicated package under `launcher/`

- A **dedicated launcher package** lives under **`launcher/`** (new workspace, same pattern as `cli/`, `web/`, `tui/`). It is implemented in **`launcher/src/index.ts`** using **Commander** for argument parsing. The package has a build step that compiles to **`launcher/build/index.js`**; the root package `bin` for `mcp-inspector` points to that file.
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

- Each app has **two parts**: (1) a **small entrypoint** in **`index.ts`** (built to `build/index.js`) that only detects “run as main” and calls the runner with `process.argv`; (2) the **runner** in **`web.ts`** / **`cli.ts`** / **`tui.tsx`** that contains all parsing, config, and app logic (`runWeb`, `runCli`, `runTui`). The entrypoint is a thin wrapper; the runner is the single code path whether invoked from the launcher or from the app binary.
- Entrypoints are consistently named **`index.js`** under **`build/`**: `web/build/index.js`, `cli/build/index.js`, `tui/build/index.js`. The launcher and package `bin` fields point at these.
- Direct launch and launcher-invoked launch use the **same** runner code; the only difference is whether the process was started by the user running the app binary or by the launcher calling the runner. Behavior is identical.

### 5. Summary

| Component            | Location                                                                                       | Responsibility                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Launcher**         | **`launcher/`** package (`src/index.ts`, Commander, build → `build/index.js`)                  | Parse only `--web`/`--cli`/`--tui` and `-h`. Show launcher help (mode options only). Call `runWeb(argv)` / `runCli(argv)` / `runTui(argv)` in-process. No config processing. Root `bin` points to `launcher/build/index.js`.                               |
| **Config processor** | **Core** (`core/mcp/node/`)                                                                    | Library: **helper functions** (e.g. `parseKeyValuePair`, `parseHeaderPair`) for option parsing; `resolveServerConfigs(options, mode)` returns **list** of `MCPServerConfig`. No Commander in core; each runner defines its own Commander options in place. |
| **Runners**          | **Web** (`web/`), **CLI** (`cli/`), **TUI** (`tui/`)                                           | Parse argv, show app help, call core config processor with server-config subset and mode, get list of configs, run app. Same behavior when called from launcher or from app entrypoint.                                                                    |
| **App entrypoints**  | **`index.js`** per app (e.g. `web/build/index.js`, `cli/build/index.js`, `tui/build/index.js`) | Thin wrapper: call runner with `process.argv`.                                                                                                                                                                                                             |

### 6. Phasing

1. **Core config module**  
   **Done.** Core exports `parseKeyValuePair`, `parseHeaderPair`, `ServerConfigOptions`, `resolveServerConfigs(options, mode)` (single/multi), and `getNamedServerConfigs` (for TUI). CLI duplicate `argsToMcpServerConfig` removed.

2. **Web runner**  
   **Done.** `runWeb(argv)` in `web/src/web.ts` parses argv with Commander, calls core in single-server mode, handles `--dev` and `-h`, then spawns dev/prod client. Entrypoint `web/src/index.ts` → `runWeb(process.argv)`. Build: `web/build/index.js`.

3. **CLI runner**  
   **Done.** `runCli(argv)` in `cli/src/cli.ts` parses argv with Commander, calls core in single-server mode, handles `--method`, `-h`, etc. Entrypoint `cli/src/index.ts` → `runCli(process.argv)`. Build: `cli/build/index.js`.

4. **TUI runner**  
   **Done.** `runTui(args?)` in `tui/tui.tsx` parses argv with Commander, uses core `getNamedServerConfigs` or `resolveServerConfigs(..., "multi")`. Entrypoint `tui/index.ts` → `runTui(process.argv)`. Build: `tui/build/index.js`.

5. **Launcher package (`launcher/`)**  
   **Done.** Workspace **`launcher/`** with `src/index.ts` using Commander to parse **only** `--web`/`--cli`/`--tui` and `-h`. Dynamic import of the chosen app and call the exported runner with argv: `runWeb(process.argv)` / `runCli(process.argv)` / `runTui(process.argv)`. No config processing; no spawn. Build to `launcher/build/index.js`; root package `bin` for `mcp-inspector` points to that file.

6. **Entrypoints and direct launch**  
   **Done.** All apps use **`build/index.js`**: `web/build/index.js`, `cli/build/index.js`, `tui/build/index.js`. Each entrypoint is a thin wrapper that calls the runner with `process.argv`. Root and workspace `package.json` `bin` and scripts point at these paths. Direct run behaves identically to launcher-invoked run.

---

## Phase 2: Web server in-process and config as object

### Goal

- The web runner starts the **Vite dev server** and **Hono production server** via their **Node APIs** (in-process), instead of spawning them as separate processes.
- Config (initial MCP server(s), auth token, port, etc.) is passed as a **single config object** into the code that starts each server. No serialization to environment variables and no env parsing inside the servers.
- The same runner process **is** the web server: one process for dev (Vite API) and one for prod (Hono in-process). This removes the “launcher spawns server” split and makes richer config (e.g. multi-server) straightforward.

### Current state (after Phase 1)

- The web runner (`runWeb` in `web.ts`) **spawns** either:
  - **Dev:** `npx vite` as a child process, with MCP and auth config passed via env vars (`MCP_INITIAL_*`, `MCP_ENV_VARS`, auth token, etc.).
  - **Prod:** `node dist/server.js` (Hono) as a child process, same env-var handoff.
- The child reads `process.env` and reconstructs config. This works but:
  - **Doesn’t scale:** Multi-server or more complex config would require more env vars and ad-hoc encoding (e.g. JSON in env).
  - **Fragile:** Many env keys, easy to get out of sync between runner and server.
  - **Unnecessary process boundary:** The runner could just start the server in the same process and pass a config object.

### APIs (actual)

**Vite (dev):** `import { createServer } from 'vite'`. `createServer(inlineConfig?: InlineConfig): Promise<ViteDevServer>`. `ViteDevServer.listen(port?: number, isRestart?: boolean): Promise<ViteDevServer>`. `ViteDevServer.close(): Promise<void>`. The Vite plugin in `vite.config.ts` already patches `server.close` to call `sandboxController.close()` first.

**Hono (prod):** `import { serve } from '@hono/node-server'`. `serve(options, listeningCallback?)` returns Node's `http.Server`. `http.Server.close(callback?: (err?: Error) => void): this`. Prod also has `sandboxController`; shutdown must close sandbox then the HTTP server (wrap `server.close` in a Promise for async).

### Design

1. **Runner starts server via API**
   - **Dev:** Use Vite’s Node API (`createServer` from `vite`) in the same process. Call `server.listen(port)`. HMR and all Vite dev behavior are unchanged; the CLI is a thin wrapper around this API.
   - **Prod:** Call `startHonoServer(config)` (refactored from current `server.ts`); no spawn of `node dist/server.js`.
   - No `spawn`/`exec` of Vite or Hono; one Node process for the web app.

2. **Config as object**
   - Define `WebServerConfig`: port, hostname, authToken, dangerouslyOmitAuth, initialMcpConfig (single `MCPServerConfig` or null), storageDir, allowedOrigins, sandbox options, optional logger. Runner builds it from argv + core `resolveServerConfigs`.
   - Runner calls `startViteDevServer(config)` or `startHonoServer(config)`; both return `Promise<{ close(): Promise<void> }>`. Startup code uses the config object; no `process.env` for handoff.
   - Env vars are only used where they are truly environment-specific (e.g. `NODE_ENV`, optional overrides). MCP/server config is not passed via env.

3. **Servers implement the config**
   - The **Vite dev** setup (middleware or plugin if needed) and the **Hono prod** app receive the config object and implement it: e.g. which initial server(s) to show, auth requirements, etc. Logic that today reads `MCP_INITIAL_*` and similar env vars is replaced by reading from the passed config.

4. **Benefits**
   - **Simpler:** No env var encoding/decoding; no long list of `MCP_INITIAL_*` and friends.
   - **Scalable:** Multi-server config (and future options) are just more fields on the object; no need to invent new env vars or JSON-in-env schemes.
   - **Single process:** Easier debugging, no spawn/kill plumbing, clear shutdown (close server and exit).

5. **Tradeoffs**
   - **Crash isolation:** If the server crashes, the whole process exits (same as today for the child; the parent runner would exit too once we’re in-process). Acceptable for a dev tool.
   - **Shutdown:** Runner registers SIGINT/SIGTERM; handler calls `await handle.close()` then `process.exit(0)`. No drain wait; user said stop, so we stop.

### Phasing (Phase 2)

1. **Define WebServerConfig and start functions**
   - Add `WebServerConfig` in web package (e.g. `web/src/web-server-config.ts`): port, hostname, authToken, dangerouslyOmitAuth, initialMcpConfig, storageDir, allowedOrigins, sandbox options, optional logger. Runner builds from argv + core processor.
   - API: `startViteDevServer(config: WebServerConfig): Promise<{ close(): Promise<void> }>` and `startHonoServer(config: WebServerConfig): Promise<{ close(): Promise<void> }>`. Runner calls one, stores the returned handle, and on SIGINT/SIGTERM calls `await handle.close()` then `process.exit(0)`. Implementations in web package.

2. **Vite dev: startViteDevServer**
   - Implement `startViteDevServer(config: WebServerConfig): Promise<{ close(): Promise<void> }>`. Call `createServer(inlineConfig)` with config that includes the existing plugin (pass config into plugin). `await server.listen(config.port, config.hostname)`. Return `{ close: () => server.close() }`. Remove spawn of `npx vite` and `MCP_INITIAL_*` env vars.

3. **Hono prod: startHonoServer**
   - Export `startHonoServer(config: WebServerConfig): Promise<{ close(): Promise<void> }>` from web package. Create sandboxController, start it, build Hono app and `createRemoteApp` from config, call `serve(...)` from `@hono/node-server`, return `{ close: async () => { await sandboxController.close(); await new Promise<void>((res, rej) => httpServer.close(err => err ? rej(err) : res())); } }`. Do not register SIGINT/SIGTERM inside; runner owns signals. Remove spawn of `node dist/server.js`.

4. **Config to client**
   - Server gets config from `WebServerConfig` at start. Expose to client via `/api/config` or inline in HTML. Remove reads of `MCP_INITIAL_*` and `MCP_ENV_VARS` in server and Vite plugin.

5. **Remove handoff env vars**
   - Delete code that sets or reads `MCP_INITIAL_COMMAND`, `MCP_INITIAL_ARGS`, `MCP_INITIAL_TRANSPORT`, `MCP_INITIAL_SERVER_URL`, `MCP_INITIAL_HEADERS`, `MCP_INITIAL_CWD`, `MCP_ENV_VARS` for runner→server handoff. Update tests and docs.

### References (Phase 2)

- Vite: `createServer` / `ViteDevServer.listen` / `ViteDevServer.close` — https://vitejs.dev/guide/api-javascript.html
- Hono: `serve` from `@hono/node-server` returns Node `http.Server`; `server.close(callback)` for shutdown.
- Web runner: `web/src/web.ts`. Prod server: `web/src/server.ts`. Vite plugin: `web/vite.config.ts` (honoMiddlewarePlugin, server.close patch).

---

## References

- Launcher: `launcher/src/index.ts` (Commander for --web/--cli/--tui only; dynamic import and call runWeb/runCli/runTui with process.argv). Build: `launcher/build/index.js`.
- Web: entrypoint `web/src/index.ts` → `runWeb(process.argv)`; runner `web/src/web.ts` (Commander, core resolveServerConfigs single-server, spawn dev/prod client). Build: `web/build/index.js`.
- CLI: entrypoint `cli/src/index.ts` → `runCli(process.argv)`; runner `cli/src/cli.ts` (Commander, core resolveServerConfigs single-server, callMethod). Build: `cli/build/index.js`.
- TUI: entrypoint `tui/index.ts` → `runTui(process.argv)`; runner `tui/tui.tsx` (Commander, core getNamedServerConfigs / resolveServerConfigs multi-server). Build: `tui/build/index.js`.
- Core config: `core/mcp/node/config.ts` (ServerConfigOptions, parseKeyValuePair, parseHeaderPair, resolveServerConfigs, getNamedServerConfigs, loadMcpServersConfig).
