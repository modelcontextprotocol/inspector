# Refactor Recreate Spec

Use this spec to **recreate** the refactor (remove client/server, rename shared→core) after making PR feedback changes on the old layout. Order: Part 1 (client/server removal), then Part 2 (shared→core rename).

---

## Part 1 — Remove client and server

### 1.1 Delete directories

- Delete `client/`
- Delete `server/`

### 1.2 Root `package.json`

- **files:** Remove `"client/bin"`, `"client/dist"`, `"server/build"`. Keep `"web/bin"`, `"web/dist"`, `"cli/build"`, `"tui/build"`.
- **workspaces:** Remove `"client"`, `"server"`. Keep `"web"`, `"cli"`, `"tui"`, `"shared"` (pre-rename) or `"core"` (if doing Part 2).
- **scripts:**
  - **build:** `npm run build-shared && npm run build-web && npm run build-cli && npm run build-tui` → drop `build-server` and `build-client`; use `build-core` if already on core.
  - Remove **build-server**, **build-client**.
  - **clean:** Remove paths for client/server; include `./web/node_modules`, `./core/node_modules` (or `./shared/node_modules`), `./web/dist`, `./cli/build`, `./tui/build`.
  - **dev**, **dev:windows:** `sh scripts/run-web.sh --dev`.
  - **start:** `sh scripts/run-web.sh`. Remove **start-server**, **start-client**.
  - **test:** `cd web && npm test` (not `cd client`).
  - **test:e2e:** `--workspace=web` (not `--workspace=client`).
  - **lint:** `cd web && npm run lint` (not `cd client`).
- **dependencies:** Remove `@modelcontextprotocol/inspector-client`, `@modelcontextprotocol/inspector-server`. Ensure `@modelcontextprotocol/inspector-web` is present.

### 1.3 Version scripts

- **scripts/check-version-consistency.js:** In the package list, remove `"client/package.json"`, `"server/package.json"`; include `"web/package.json"`. In workspace packages, remove client and server entries; include web (and core or shared).
- **scripts/update-version.js:** Same package list: no client/server, include web (and core or shared).

### 1.4 CI

- **.github/workflows/main.yml:** Lint and test steps use `working-directory: ./web` (not `./client`); label e.g. "Run web tests".
- **.github/workflows/e2e_tests.yml:** Artifacts and report use `web/` paths (e.g. `web/playwright-report/`, `web/test-results/`, `web/results.json`), not `client/`.

### 1.5 Docker

- **Dockerfile:** Copy and build only web, cli, shared (or core), tui. No client/server copy or build. Production: copy `web/dist`, `web/bin`, `cli/build`; run `CMD ["node", "web/bin/server.js"]`; `ENV PORT=6274`; `EXPOSE ${PORT}`.
- **.dockerignore:** Remove client/server build dirs; ignore web/dist, cli/build, tui/build as needed.

### 1.6 Docs / project guide

- **AGENTS.md:** Build commands and project layout refer to `web/` (and core or shared), not client/server.

### 1.7 CLI default to web

- **cli/src/cli.ts:**
  - Remove `runWebClient()` (and any use of `client/bin/start.js`).
  - Default branch: when not `--cli` and not `--tui`, call `runWeb(args)`.
  - Add `.option("--web", "launch web app (default)")` so existing scripts keep working.
  - Remove the `useWeb` check and argv filtering; keep a single path: `args.cli ? runCli : runWeb`.

### 1.8 Lockfile

- Delete `package-lock.json`, run `npm install --ignore-scripts` (or full `npm install`) so the lockfile no longer references client/server.

---

## Part 2 — Rename shared to core

### 2.1 Directory and package name

- Rename directory `shared/` → `core/`.
- In **core/package.json:** `"name": "@modelcontextprotocol/inspector-core"` (was `inspector-shared`).

### 2.2 Root and tooling

- **package.json:** workspaces use `"core"` (not `"shared"`); scripts: `build-core`, `test-core`, `cd core`; clean script uses `./core/node_modules`.
- **Dockerfile:** `COPY core/package*.json ./core/` (both build and prod stages).
- **.github/workflows/cli_tests.yml:** "Build core package", `npm run build-core`.

### 2.3 Consuming packages

- **web/package.json**, **cli/package.json**, **tui/package.json:** Dependency `@modelcontextprotocol/inspector-shared` → `@modelcontextprotocol/inspector-core`.

### 2.4 TypeScript project references

- **cli/tsconfig.json**, **tui/tsconfig.json:** `references` entry `"path": "../shared"` → `"path": "../core"`.

### 2.5 Imports and paths

- **All code:** Replace package imports `@modelcontextprotocol/inspector-shared` with `@modelcontextprotocol/inspector-core` (every workspace: web, cli, tui, and inside core).
- **CLI tests:** Paths `../../shared/` → `../../core/`, `../../../shared/` → `../../../core/` in imports.
- **core:** JSDoc in `core/mcp/remote/createRemoteTransport.ts`: `inspector-shared` → `inspector-core` in example import.

### 2.6 Version scripts

- **scripts/check-version-consistency.js:** Include `"core/package.json"` in the list; in workspace packages include `{ path: "core", name: "@modelcontextprotocol/inspector-core" }`.
- **scripts/update-version.js:** Include `"core/package.json"` in the list.

### 2.7 Docs

- In **docs/** (e.g. shared-code-architecture.md, .svg, environment-isolation.md, web-client-port-plan.md, tui-web-client-feature-gaps.md, tui-oauth-implementation-plan.md, oauth-inspectorclient-design.md): replace references to the **repo** package/dir name and paths: `shared/` → `core/`, `inspector-shared` → `inspector-core`. Do **not** change `@modelcontextprotocol/sdk`'s own paths (e.g. `shared/protocol` in the SDK).

### 2.8 AGENTS.md

- Project layout and commands refer to `core/` (and "core shared code"), not `shared/`.

### 2.9 Lockfile

- After all of the above, delete `package-lock.json` and run `npm install --ignore-scripts` (or `npm install`) so the lockfile only has the core workspace and no stale shared/client/server entries.

---

## Order and verification

- If recreating from a tree that still has **client**, **server**, and **shared**: do **Part 1** (remove client/server), then **Part 2** (rename shared→core). If the tree already has client/server removed but still has shared, do only **Part 2**.
- After recreation: `npm run build` and root `npm run test` (and optionally `npm run test-cli`, `npm run test-core`) should pass; lockfile should have no client/server and use `core` for the former shared package.
