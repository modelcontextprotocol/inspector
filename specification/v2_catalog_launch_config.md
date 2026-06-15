# Inspector V2 Tech Stack - Storage - Catalog and Launch Configuration

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

#### [Web Client](v2_web_client.md) | [CLI, TUI, Launcher](v2_cli_tui_launcher.md) | [Server](v2_server.md) | [Storage](v2_storage.md)
##### [Overview](v2_storage.md) | [Server List File](v2_servers_file.md) | Catalog and Launch

## Table of Contents

  * [Summary](#summary)
  * [Goals](#goals)
  * [Non-goals](#non-goals)
  * [Related specifications](#related-specifications)
  * [Terminology](#terminology)
  * [User intents (UC1–UC5)](#user-intents-uc1uc5)
  * [Flag reference](#flag-reference)
  * [Background (v1.5)](#background-v15)
  * [Normalization](#normalization)
  * [Cross-client list contract](#cross-client-list-contract)
  * [Launch behavior by client](#launch-behavior-by-client)
  * [Import (UC2)](#import-uc2)
  * [Write-back policy](#write-back-policy)
  * [Web launch behavior](#web-launch-behavior)
  * [Target API (core)](#target-api-core)
  * [Open decisions](#open-decisions)
  * [Known gaps](#known-gaps)
  * [Decision matrix](#decision-matrix)
  * [Engineering follow-ups](#engineering-follow-ups)
  * [Related GitHub issues](#related-github-issues)
  * [References](#references)

## Summary

v2 treats `~/.mcp-inspector/mcp.json` as the default **catalog** — a persistent, Inspector-owned grouping of MCP servers. The web client loads and mutates it via `/api/servers`. CLI and TUI resolve servers from that path when launch args omit both `--config` and ad-hoc targets (`resolveLaunchServerConfigs()` / `withDefaultConfigPath()` in `core/mcp/node/config.ts`).

This specification defines **launch-time configuration** across web, CLI, and TUI: how `--catalog`, `--config`, `--server`, and ad-hoc flags select a server list; which paths are writable; and how import differs from session launch. On-disk catalog format and web CRUD are specified in [Server List File](v2_servers_file.md). CLI/TUI/launcher build and per-client implementation gaps are in [CLI, TUI, and Launcher](v2_cli_tui_launcher.md).

## Goals

- One **catalog** model shared by web, CLI, and TUI, with a clear split between **catalog modes** (writable, UC1/UC4) and **session mode** (read-only, UC3).
- **`--catalog`** selects the active writable catalog; **`--config`** without catalog intent supplies a read-only session file — not overloaded.
- All reads **parse → normalize → lift** into canonical `ServerEntry[]`; catalog writes serialize through the same contract as [Server List File](v2_servers_file.md).
- **List clients** (web, TUI) consume the same resolved list plus `writable`, `defaultServerId`, and optional `autoConnect` — resolution in **core**, not the launcher.
- **Import** is an explicit catalog mutation (`servers/import` on CLI; web Import menu) — never a side effect of launch.
- **CLI** resolves a single server through the same normalizer as list clients, including disk **settings** lift.
- **Web** follows **catalog-first** launch: full catalog visible; `--server` selects an entry; ad-hoc launches do not auto-persist.

## Non-goals

- Syncing with Claude Desktop, Cursor, or other tools' config paths (symlinking is the user's choice — see [Server List File](v2_servers_file.md)).
- Silent write-back of launch overrides (`-e`, `--cwd`, `--header`) to catalog or session files.
- Launcher as config arbitrator — it routes mode and forwards argv only.
- Requiring import support on all three clients at startup (UC2 is CLI + web UI).
- Auto-importing ad-hoc launches into the catalog.
- File watching or two-way sync with external MCP client configs.

## Related specifications

| Document | Owns |
|----------|------|
| [v2_servers_file.md](v2_servers_file.md) | Catalog path, on-disk shape, web CRUD, `/api/servers`, per-server settings |
| [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md) | Bins, tsup, tests, `runWeb`, CLI config-file settings gap (G1) |
| [v2_ux.md](v2_ux.md) | Import config vs Import server.json menu UX |
| v1.5 `docs/mcp-server-configuration.md` | Baseline shared launch flags (port to v2 pending, G6) |

---

## Terminology

| Term | Meaning |
|------|---------|
| **Catalog** | Inspector-owned `mcp.json` used as a persistent server grouping. Default: `~/.mcp-inspector/mcp.json`. Active catalog selected by `--catalog <path>` or default (UC1/UC4). CRUD when `writable: true`. |
| **`--catalog`** | Selects the **active catalog** for this run (`writable: true`). Omitted → default path (UC1). |
| **Alternate config file** | Any JSON passed via `--config <path>` without catalog intent. **Read-only, run-scoped** server set (UC3). Inspector does not write to this path. |
| **Canonical catalog format** | Normalized `MCPConfig` / `ServerEntry[]` after `normalizeServerType`, `normalizeMcpServers`, and `mcpConfigToServerEntries` — the only shape written to a catalog. |
| **Catalog lookup** | `--server <name>` with no `--config` and no ad-hoc target. `resolveLaunchServerConfigs()` injects the catalog path via `withDefaultConfigPath()`, then the named entry is resolved. |
| **Ad-hoc / inline config** | Positional command/URL and/or `--transport`, `--server-url`, `-e`, `--cwd`, `--header` without `--config`. Ephemeral unless the user persists via CRUD or import. |
| **Launch-time initial config (web)** | `initialMcpConfig` from `runWeb(argv)` → `GET /api/config`. Legacy v1.5 channel; largely unused by the v2 web UI today (G2). |

---

## User intents (UC1–UC5)

Five distinct user goals. They share flags (`--config`, `--server`, `--catalog`) but differ in **whether the list is the catalog, read-only, or mutated**, and **which client** owns each action.

### UC1 — Default catalog: run and manage servers in place

**Intent:** Use the usual server list at `~/.mcp-inspector/mcp.json` — the default active catalog (UC4 with default path). Add, edit, remove, and configure settings through the UX; CLI invokes methods against a named catalog entry.

| | Today | Target |
|---|--------|--------|
| **Web** | Works — `useServers` + `/api/servers` CRUD | Same |
| **TUI** | Loads default catalog via `withDefaultConfigPath` in `loadTuiServers`; **no CRUD UX yet** | Catalog CRUD in TUI (planned) |
| **CLI** | `--server foo --method …` with no `--config` resolves against default catalog | Same; lift settings from catalog entries (G1) |

```bash
mcp-inspector --web
mcp-inspector --cli --server my-api --method tools/list
mcp-inspector --tui
```

The catalog is both the **data source** and the **write target** (`writable: true`).

### UC2 — Import into a catalog (automation / one-off CLI)

**Intent:** Add servers **into** an Inspector catalog (default or `--catalog` target). Distinct from “launch and use for this session” (UC3). Import is a **catalog write**, not a launch mode.

| Source | CLI shape | Stored |
|--------|-----------|--------|
| **A — `mcpServers` file** | `--config /path/to/source.json` [ `--server <name>` ] `--method servers/import` | One or all entries, canonicalized |
| **B — Ad-hoc parts** | Same argv as ad-hoc launch (`[target...]`, `--transport`, `--server-url`, `-e`, `--cwd`, `--header`, …); no `--config`. Method → `servers/import`. | One entry; **`--server <id>`** = catalog map key (required for B) |

```bash
# A: import all from a foreign mcp.json
mcp-inspector --cli --config /path/to/claude.json --method servers/import

# A: one named entry from source file (--server = name in source)
mcp-inspector --cli --config /path/to/claude.json --server acme --method servers/import

# B: stdio — launch vs import differ only by --method and --server (catalog id)
mcp-inspector --cli \
  -e API_KEY=dev --cwd /path/to/server \
  node ./build/index.js --method tools/list

mcp-inspector --cli \
  --server my-local \
  -e API_KEY=dev --cwd /path/to/server \
  node ./build/index.js --method servers/import

# B: streamable HTTP
mcp-inspector --cli \
  --transport streamable-http \
  --server-url https://api.example.com/mcp \
  --header "Authorization: Bearer xxx" \
  --method tools/list

mcp-inspector --cli \
  --server staging-api \
  --transport streamable-http \
  --server-url https://api.example.com/mcp \
  --header "Authorization: Bearer xxx" \
  --method servers/import

# Into a non-default catalog (UC4)
mcp-inspector --cli --catalog ./project/.mcp-inspector/mcp.json \
  --config ./vendor.json --method servers/import
```

**Not UC2:** `mcp-inspector --cli node ./server.js --method tools/list` without `servers/import` is UC3/UC1 (use now), not import.

| | Today | Target |
|---|--------|--------|
| **CLI** | Not implemented | `servers/import` for A and B via `importServersIntoCatalog` in core |
| **Web** | Import menu items stubbed | Interactive import per [v2_ux.md](v2_ux.md); [#1348](https://github.com/modelcontextprotocol/inspector/issues/1348), [#1435](https://github.com/modelcontextprotocol/inspector/issues/1435) |
| **TUI** | N/A | No requirement |

See [Import (UC2)](#import-uc2) for behavior rules.

### UC3 — Launch with a specific config (session list, not the catalog)

**Intent:** Run against **another** server set for **this session only** — ad-hoc (one server from command/URL) or file (all servers in TUI; one selected by `--server` for CLI). User sees those servers in list UI; Add/Edit/Remove must not mutate the file (`writable: false`).

| | Today | Target |
|---|--------|--------|
| **TUI** | Works for `--config <file>` and ad-hoc via `loadTuiServers` | Same + explicit `writable: false` for non-catalog paths |
| **Web** | UI always shows default catalog; `runWeb --config` only sets legacy `initialMcpConfig` | Session `mcpConfigPath` → `/api/servers` serves that file; `writable: false`; disable CRUD |
| **CLI** | Single resolved server (file + `--server`, ad-hoc, or default catalog) | Same; shared normalizer + settings lift |

```bash
mcp-inspector --tui --config ~/Library/Application\ Support/Claude/claude_desktop_config.json
mcp-inspector --cli --config ./project/mcp.json --server local --method tools/list
mcp-inspector --cli node ./server.js --method tools/list
```

Launching with `--config` does **not** import unless the user separately runs UC2.

### UC4 — Choose which catalog (grouping), not only the default

**Intent:** Catalogs **group** MCP configs for reuse. Most users only use the default (UC1). Power users switch catalogs — per-project files, work vs personal, repo-local `.mcp-inspector/mcp.json`.

**`--catalog <path>`** selects the **active catalog** for this run. Omitting it → default (UC1).

```bash
mcp-inspector --web
mcp-inspector --web --catalog ./.mcp-inspector/mcp.json
mcp-inspector --tui --catalog ~/work/mcp.json
mcp-inspector --cli --catalog ~/work/mcp.json --server api --method tools/list
```

**Distinction from UC3:** UC3 uses **`--config`** (or ad-hoc) for a foreign/session file — show servers, **do not write**. UC4 uses **`--catalog`** — this file **is** the Inspector catalog for this run.

| | Today | Target |
|---|--------|--------|
| **Web** | Only default catalog — backend always `getDefaultMcpConfigPath()` | `runWeb --catalog <path>` → `mcpConfigPath`; CRUD on active catalog |
| **TUI** | `--config` loads a file; no catalog vs session distinction | `--catalog` = writable active catalog; `--config` without `--catalog` → UC3 |
| **CLI** | `--config` for one-shot reads; default path when only `--server` | `--catalog` scopes UC1/UC2/UC5; `--config` remains session-only |

**Env alternative:** `MCP_CATALOG_PATH` — same semantics as `--catalog` for scripts/CI.

### UC5 — Default selection within any list

**Intent:** Among loaded servers (catalog or session), focus one entry — required for CLI (one server), useful for web/TUI.

| | Today | Target |
|---|--------|--------|
| **CLI** | `--server` with catalog (UC1) or `--config` file (UC3) | Same |
| **TUI** | All servers shown; no `--server` flag | Optional highlight / initial selection |
| **Web** | Ignores `--server` for list/selection | `defaultServerId` from launch + optional auto-connect ([#1183](https://github.com/modelcontextprotocol/inspector/issues/1183)) |

### Use-case map (quick reference)

| UC | User goal | How selected | Writable? | Primary clients | Import? |
|----|-----------|--------------|-----------|-----------------|---------|
| **1** | Manage default catalog | (no `--catalog`) | Yes | Web (now), TUI (CRUD planned), CLI | No |
| **2** | Add servers to a catalog | `--method servers/import` | Writes **active catalog** only | CLI; web UI | Yes |
| **3** | Session with external config | `--config` or ad-hoc | **No** | TUI (now), Web (gap), CLI | No |
| **4** | Switch / use another catalog | `--catalog <path>` | Yes (that path) | Web/TUI (gaps) | Via UC2 |
| **5** | Pick one server by name | `--server` | — | CLI (required), Web/TUI (hint) | — |

**Design principle:** UC1 is UC4 with the default path. Catalog modes (UC1/UC4): `writable: true`. Session mode (UC3): `writable: false`. UC2 mutates the active catalog only — not a launch side-effect on all clients.

---

## Flag reference

Shared launch flags (full detail in v1.5 `docs/mcp-server-configuration.md`, port pending):

| Flag | UC1/UC4 (catalog) | UC3 (session) | UC2 (import) |
|------|-------------------|---------------|--------------|
| `--catalog <path>` | Active writable catalog | — | Target catalog for write |
| `--config <path>` | — | Read-only session file | **Source** file (A only) |
| `--server <name>` | Catalog entry id (UC5) | Entry in session file | Source name (A) or new catalog id (B) |
| `[target...]`, `-e`, `--cwd`, `--transport`, `--server-url`, `--header` | Ad-hoc overrides on connect | Ad-hoc session server | Same argv as launch (B) |

**`--server` overload (by context — no new flags):**

| Context | `--server` means |
|---------|------------------|
| `servers/import` + `--config` | Entry to copy **from source file** |
| `servers/import` + ad-hoc (no `--config`) | Catalog **id** for new entry |
| `tools/list` (etc.) + no `--config` | Lookup **from active catalog** |
| `tools/list` + `--config` | Lookup **from session file** |

Optional import flags (target): `--on-conflict skip|error|replace`.

---

## Background (v1.5)

v1.5 (`docs/mcp-server-configuration.md`) had no default catalog: omitting `--config` and positional args failed resolution. Config-file `headers` lived on `MCPServerConfig`. Web had no file-backed list — launcher argv became `initialMcpConfig` for form pre-fill only. v2 adds the persistent catalog ([Server List File](v2_servers_file.md)), flat on-disk settings (post-#1358), and `resolveLaunchServerConfigs()` for CLI/TUI launch resolution.

---

## Normalization

External config files (Claude Desktop, Cursor, hand-edited JSON) are not reliably conformant. **Read path:** always parse → normalize → lift; never connect from raw file bytes.

| Stage | Where | What |
|-------|-------|------|
| Parse | `loadMcpServersConfig` / backend JSON parse | Structural check; tolerate unknown keys |
| Normalize transport | `normalizeServerType` (`core/mcp/serverList.ts`) | Missing type → `stdio`; `http` → `streamable-http` |
| Normalize catalog entries | `normalizeMcpServers` (`core/mcp/remote/node/server.ts`) | Legacy `settings` hard-cutover; secret migration |
| Lift to runtime | `mcpConfigToServerEntries` | Map key → `id`; flat disk fields → `InspectorServerSettings` |

**Write path (catalog only):** `serverEntriesToMcpConfig` / `buildStoredEntry` / `writeStoreFile` per [Server List File](v2_servers_file.md).

**UC3 session files:** normalize on read; no silent writes. Persistence into a catalog requires UC2, web CRUD, or manual edit outside Inspector.

**Ad-hoc inline config:** ephemeral; never written by the runner.

---

## Cross-client list contract

Web and TUI are **list clients**: display servers, pick/connect, edit only when `writable`. They need not distinguish catalog path from session path in the UI — only the resolved list and flags.

Required inputs:

1. **Canonical list** — `ServerEntry[]` after normalize + `mcpConfigToServerEntries`.
2. **`writable`** — if false, hide/disable Add, Edit, Remove, settings-save-to-disk.
3. **`defaultServerId`** — from `--server` (UC5).
4. Optional **`autoConnect`** — [#1183](https://github.com/modelcontextprotocol/inspector/issues/1183).

Centralization belongs in **core**, not the launcher. Today:

| Piece | Today | Target |
|-------|--------|--------|
| **Canonical conversion** | `mcpConfigToServerEntries` | Same |
| **TUI** | `loadTuiServers` — full settings; no `writable` | `resolveServerList`; gate UI on `writable` |
| **Web** | `useServers` → always default catalog; CRUD always on | `/api/servers` returns session or catalog list + `writable` |
| **CLI** | Single server via `resolveLaunchServerConfigs` | `resolveSingleServer` from same normalizer |
| **Launcher** | Forwards argv | Unchanged |

Import is not a list-client concern — catalog mutation via UC2 or web CRUD when `writable`.

---

## Launch behavior by client

### Web

| Launch | Catalog (`/api/servers`) | `initialMcpConfig` → `/api/config` | Connect |
|--------|--------------------------|--------------------------------------|---------|
| No server args | Default catalog via `useServers` | Empty | User selects catalog server |
| Ad-hoc server flags | **Still full default catalog** | Populated (transport fields) | **Launch config not consumed** — no auto-connect, no form pre-fill (G2) |
| `--config` + `--server` | **Still default catalog** | Populated from resolved config (settings stripped) | User sees catalog, not launch file |

**Target:** `/api/servers` serves the **resolved** list for the session (catalog or UC3 file) with `writable` and `defaultServerId`. See [Web launch behavior](#web-launch-behavior).

### CLI and TUI

CLI connects to exactly one resolved config per invocation; TUI shows all entries from the resolved list. Resolution paths, settings lift, and port gaps are documented in [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md). Key catalog-specific gaps: **G1** (CLI drops disk settings on catalog/file lookup), **G4** (web `runWeb --header` warns only).

### Shared resolvers (`resolveLaunchServerConfigs` / `resolveServerConfigs`)

CLI and TUI call `resolveLaunchServerConfigs()` at launch; it applies `withDefaultConfigPath()` then delegates to `resolveServerConfigs()`:

```
withDefaultConfigPath(options)
  → if no --config and no ad-hoc target: configPath = ~/.mcp-inspector/mcp.json

resolveServerConfigs(options, mode)  — explicit options only; no default injection
```

**single mode (CLI):**

```
configPath + serverName → loadServerFromConfig (MCPServerConfig only — G1)
configPath, no serverName → sole entry or error if multiple
ad-hoc → buildConfigFromOptions
```

**multi mode (TUI):**

```
configPath → all entries via mcpConfigToServerEntries (settings lifted) in loadTuiServers
ad-hoc → resolveServerConfigs(..., "multi") in loadTuiServers
```

Web `runWeb` uses `resolveServerConfigs()` directly (explicit server argv only); catalog path is backend-owned until launch-config unification.

`loadServerFromConfig` returns bare `MCPServerConfig`. Only `mcpConfigToServerEntries()` lifts flat disk fields into `InspectorServerSettings`.

---

## Import (UC2)

**`servers/import`** on CLI only (plus web Import menu for interactive use). Targets the **active catalog** (default or `--catalog`). No launcher `--import` flag — `mcp-inspector --cli … --method servers/import` is sufficient.

| Approach | Rationale |
|----------|-----------|
| **CLI method** | Explicit, scriptable, reuses `--config` / ad-hoc argv parsing; same normalization as `POST /api/servers` |
| **Not launcher flag** | Launcher routes only; catalog mutation blurs responsibilities |
| **Not all clients at startup** | TUI/web import is UI concern (paste/upload) |

**Behavior:**

1. **UC2-A:** read `--config` source → canonicalize → one or all entries (`--server` optional).
2. **UC2-B:** build one entry from ad-hoc argv (same resolver as UC3 launch) → `--server <id>` names catalog entry → canonicalize.
3. Write to **active catalog** via `importServersIntoCatalog` — never to the UC3 source file.
4. Collision policy per entry: skip, replace, or error (default TBD).
5. Exit 0 with summary JSON (imported ids, skipped duplicates).

Web **Import config** vs **Import server.json** menu semantics: [v2_ux.md](v2_ux.md) and [Server List File](v2_servers_file.md). Registry conversion: [#922](https://github.com/modelcontextprotocol/inspector/issues/922), [#1435](https://github.com/modelcontextprotocol/inspector/issues/1435).

---

## Write-back policy

No silent write-back to **any** file on launch. Catalog mutations go through `/api/servers`, `servers/import`, or explicit user CRUD.

| Action | Writes catalog? | Writes session `--config` file? |
|--------|-----------------|--------------------------------|
| Launch ad-hoc command/URL | No | No |
| Launch `--server` + overrides (`-e`, `--cwd`, `--header`) | No | No |
| Launch `--config /other.json` | No | **No** (read-only) |
| User Add/Edit/Settings (web UI) | Yes (canonical serialize) | No |
| Import config / server.json (web UI, future) | Yes | No |
| `--cli --method servers/import` | Yes (active catalog) | No |
| Future explicit `--save-as <id>` | Opt-in only | No |

**Runtime overlay model (CLI/TUI):**

```
catalog entry (config + settings)
  + override flags for this process only
  → effective connect payload
  → never persisted unless explicit CRUD or import
```

---

## Web launch behavior

**Target model: catalog-first (B1).** The catalog always exists in the UI. Launch args influence selection and connect ergonomics; they do not replace the catalog or auto-persist ad-hoc servers.

| Behavior | Rule |
|----------|------|
| Catalog UI | Always show full resolved catalog (or UC3 session list when wired) |
| `--server <id>` | Set `activeServerId` / `defaultServerId` to matching catalog entry |
| Ad-hoc inline config | Temporary “session server” or “Quick connect” — **do not** auto-`POST /api/servers` |
| Auto-connect | Optional `--connect` or `?autoConnect=true` ([#1183](https://github.com/modelcontextprotocol/inspector/issues/1183)) |

**Rejected alternatives:** launch-only UI hiding catalog (B2); v1.5 form pre-fill without catalog (B3).

**Implementation sketch:**

1. Extend `GET /api/config` with `initialServerId` and/or settings reference.
2. `App.tsx` on load: if `initialServerId` matches an entry, set selection; optional auto-connect behind flag.
3. Ad-hoc without catalog id: non-persisted session card or “Save to catalog?” prompt.

---

## Target API (core)

Evolve `loadTuiServers` / `resolveServerConfigs` in core (not launcher):

```ts
interface ResolvedServerList {
  servers: ServerEntry[];
  writable: boolean;
  source: "catalog" | "alternate-file" | "adhoc";
  configPath?: string;
  defaultServerId?: string;
}

resolveServerList(options: ServerConfigOptions): ResolvedServerList;
resolveSingleServer(options: ServerConfigOptions): { entry: ServerEntry; ... };  // CLI

importServersIntoCatalog(
  entries: ServerEntry[],
  opts?: { onConflict: "skip" | "error" | "replace" },
): ImportResult;
```

**Rules:**

1. Ad-hoc (no `--config`, no `--catalog`) → one entry, `writable: false` (UC3).
2. `--catalog` or default → active catalog, `writable: true` (UC1/UC4).
3. `--config` without catalog intent → canonicalize → `ServerEntry[]`, `writable: false` (UC3).
4. `defaultServerId` from `--server`.
5. Runtime overlays on connect, not on disk.
6. Web `/api/servers` and TUI use `resolveServerList`; CLI uses `resolveSingleServer`.

---

## Open decisions

| Topic | Status | Notes |
|-------|--------|-------|
| Import collision default | TBD | `skip` vs `error` vs `replace` for duplicate catalog ids |
| `MCP_CATALOG_PATH` env name | Proposed | Alias for `--catalog` |
| Ad-hoc web UX detail | Partially decided | B1 catalog-first; exact “Quick connect” vs banner TBD |
| TUI `--server` initial selection | Open | Optional highlight when UC5 used from launcher |

Resolved (documented above): catalog vs session flag split; no launch write-back; CLI-only `servers/import`; core-owned `resolveServerList`; web catalog-first (B1).

---

## Known gaps

| # | Gap | Severity | Clients |
|---|-----|----------|---------|
| G1 | CLI catalog/file lookup drops settings — `loadServerFromConfig` not `mcpConfigToServerEntries` | Functional | CLI |
| G2 | Web ignores launch-time `initialMcpConfig` for list/selection/connect | Functional / UX | Web |
| G3 | `InitialConfigPayload` has no settings — cannot pass headers/oauth at web launch | Functional | Web + launcher |
| G4 | `runWeb --header` warns only | Functional | Web launcher |
| G5 | Two config pipelines — `config.ts` vs `serverList.ts` | Design debt | CLI vs TUI vs web |
| G6 | v1.5 `docs/mcp-server-configuration.md` not ported to v2 | Docs | All |
| G7 | CLI test expects `--server` without `--config` to fail — predates default catalog | Tests | CLI |
| G8 | No auto-connect ([#1183](https://github.com/modelcontextprotocol/inspector/issues/1183)) | Enhancement | Web |
| G9 | Import config / Import server.json menu stubbed | UX | Web |
| G10 | CLI thin parse path — no full `normalizeMcpServers` / settings lift on catalog GET parity | Consistency | CLI |

G1, G4, and launcher details: [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md).

---

## Decision matrix

| User launches with… | File read | Canonicalize on read? | Catalog UI (web) | Writable? |
|---------------------|-----------|----------------------|------------------|-----------|
| Nothing (defaults) | Default catalog | Yes | Full list | Catalog only |
| `--server foo` | Default catalog | Yes | Full list; should select `foo` | Catalog only |
| `--config other.json` | Alternate file (UC3) | Yes | Session list (target); today default catalog | **No** |
| `--catalog ./proj/mcp.json` | Project catalog | Yes | That catalog (target) | That path |
| Ad-hoc `node srv.js` | None | N/A | Full catalog + session hint (target) | Catalog only if user saves |
| Web Add / Edit / Import | N/A | Yes before write | Full list | Catalog only |
| `servers/import` | Source (A) or ad-hoc (B) | Yes before write | N/A (CLI) | Active catalog |

---

## Engineering follow-ups

1. **Core:** `resolveServerList`, `resolveSingleServer`, `importServersIntoCatalog`.
2. **CLI:** resolve through shared normalizer; implement `--method servers/import` (G1, G10).
3. **Web:** `/api/servers` serves resolved session or catalog list + `writable` + `defaultServerId` (G2).
4. **TUI:** `resolveServerList`; respect `writable` (no CRUD on UC3 files).
5. **Launcher / web:** extend `InitialConfigPayload` for settings at launch (G3, G4).
6. **Tests:** CLI default-catalog success with tmp catalog; import method tests (G7).
7. **Docs:** port `docs/mcp-server-configuration.md` to v2 (G6); close/update [#1347](https://github.com/modelcontextprotocol/inspector/issues/1347).

---

## Related GitHub issues

| Issue | Status | Relevance |
|-------|--------|-----------|
| [#1347](https://github.com/modelcontextprotocol/inspector/issues/1347) — default `--config` | Open (likely closable) | Implemented via `resolveLaunchServerConfigs()` |
| [#1246](https://github.com/modelcontextprotocol/inspector/issues/1246) — port CLI/TUI/launcher | Done in worktree | Parent of default-catalog behavior |
| [#1183](https://github.com/modelcontextprotocol/inspector/issues/1183) — auto-connect | Open | UC5 web ergonomics |
| [#1348](https://github.com/modelcontextprotocol/inspector/issues/1348) — import from other clients | Open | UC2 web UI |
| [#1435](https://github.com/modelcontextprotocol/inspector/issues/1435) — registry import | Open | UC2 registry path |
| [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432) — CLI v2 | Open | Session CLI umbrella |
| [#1352](https://github.com/modelcontextprotocol/inspector/pull/1352) / [#1358](https://github.com/modelcontextprotocol/inspector/pull/1358) | Merged | Flat settings on disk |
| [#1356](https://github.com/modelcontextprotocol/inspector/pull/1356) | Merged | Secrets in keychain |

---

## References

- [v2_servers_file.md](v2_servers_file.md) — catalog format, CRUD, settings on disk
- [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md) — CLI/TUI/launcher architecture and port gaps
- [v2_ux.md](v2_ux.md) — Import config vs Import server.json UX
- `core/mcp/node/config.ts` — `withDefaultConfigPath`, `resolveLaunchServerConfigs`, `resolveServerConfigs`
- `core/mcp/serverList.ts` — `mcpConfigToServerEntries`
- `clients/tui/src/tui-servers.ts` — TUI catalog + settings load path
- `clients/cli/src/cli.ts` — single-config resolve; settings gap (G1)
- `clients/web/server/run-web.ts` — launcher argv → `initialMcpConfig`
- `clients/web/src/App.tsx` — catalog via `useServers`
- `clients/web/src/components/groups/ImportServerJsonPanel/` — registry panel (unwired)
- `clients/web/src/components/groups/ServerAddMenu/ServerAddMenu.tsx` — Add menu labels
