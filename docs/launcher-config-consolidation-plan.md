# Launcher and config consolidation

This document explains the architecture of the `mcp-inspector` application entrypoints and configuration processing.

## How things used to work (and the challenges)

Previously, the project suffered from split config logic and an unnecessary process boundary for the web server:

1. **Two processes for web and CLI:** The main `mcp-inspector` entrypoint would parse arguments and then `spawn()` a child process for the actual web server (either Vite for dev, or `node dist/server.js` for prod).
2. **Config via environment variables:** To pass config (like server command, transport, auth token, etc.) from the launcher to the child process, the runner serialized everything into an unwieldy list of environment variables (`MCP_INITIAL_*`, `MCP_ENV_VARS`, etc.).
3. **Doesn't scale:** Multi-server or complex config required more environment variables and ad-hoc encoding (e.g. JSON in env). This was fragile and easy to get out of sync.
4. **Config logic split:** Config parsing was duplicated across the web runner, the CLI runner, and the TUI runner.
5. **Direct launch was inconsistent:** Running `npm run dev` or calling workspace binaries directly skipped parts of the launcher logic, leading to inconsistent behavior.

## How things work now (Current Design)

The architecture is now consolidated into a single-process model with a shared configuration processor.

### 1. Dedicated Launcher

A dedicated package under `launcher/` (`src/index.ts` → `build/index.js`) serves as the global `mcp-inspector` binary.

- **Responsibility:** Its only job is to choose which app to run (`--web`, `--cli`, or `--tui`) and to forward `process.argv`.
- **No spawn:** It dynamically imports the chosen app's runner and calls it **in-process**.

### 2. Shared Config Processor

All configuration parsing and merging rules live in **core** (`core/mcp/node/config.ts`).

- **Input:** Parsed argument options (file path, server name, env vars, transport, headers) and a mode (`single` or `multi`).
- **Output:** A list of `MCPServerConfig` objects.
- **Benefits:** Web, CLI, and TUI all share the exact same rules for loading config files, applying command-line overrides, and resolving environment variables.

### 3. App Runners

Each app (Web, CLI, TUI) exposes a **runner** function (`runWeb(argv)`, `runCli(argv)`, `runTui(argv)`).

- The runner uses Commander to parse the arguments.
- It calls the shared core config processor with the relevant server-config subset.
- It receives the config list and starts the application logic.
- Direct launch (e.g., running `mcp-inspector-cli`) just imports the runner and passes `process.argv`. This guarantees identical behavior whether invoked via the launcher or directly.

### 4. Web Server In-Process (Config as Object)

The web app no longer uses `spawn()` or environment variable handoffs. The runner process **is** the web server.

- **WebServerConfig Object:** The runner builds a typed `WebServerConfig` object (containing port, initial MCP config, auth, etc.) and passes it directly to the server.
- **Vite Dev:** `startViteDevServer(config)` uses Vite's Node API (`createServer` from `vite`) in the same process. It passes the config directly to the Hono Vite plugin via `honoMiddlewarePlugin(config)`.
- **Hono Prod:** `startHonoServer(config)` starts the production server in the same process.
- **Benefits:**
  - **Simpler & Scalable:** No env var encoding/decoding. Multi-server config is easily passed as a standard JS object.
  - **Easier debugging:** A single Node process means no spawn/kill plumbing and clear shutdown logic.

### 5. Summary of Execution Flow

| Component         | Responsibility                                                                                           |
| :---------------- | :------------------------------------------------------------------------------------------------------- |
| **Launcher**      | Detects `--web`/`--cli`/`--tui` and calls the app runner in-process.                                     |
| **Runner**        | Parses argv using Commander and calls the core config processor.                                         |
| **Core Config**   | Applies file/cli merging rules, returns `MCPServerConfig` object(s).                                     |
| **App Execution** | Runner uses the config object to directly start Vite API (dev), Hono API (prod), CLI method, or TUI app. |
