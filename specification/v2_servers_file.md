# Inspector V2 Tech Stack - Storage - Server List File

### Brief | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

#### [Web Client](v2_web_client.md) | [Server](v2_server.md)  | Storage
##### [Overview](v2_storage.md) | Server List File

## Summary

Replaces the hardcoded `SEED_SERVERS` in `clients/web/src/App.tsx:47` with a file-backed list at `~/.mcp-inspector/mcp.json`, read at startup, mutated via REST endpoints, surfaced through a `useServers` hook.

## Goals

- Persist the user's server list across restarts.
- Use the canonical `{ mcpServers: { ... } }` format so the file is interoperable with Claude Desktop / Cursor / Cline and editable by hand.
- Reuse the file-I/O facility already ported from v1.5 (`core/storage/store-io.ts`) and the parser already in `core/mcp/node/config.ts`.
- Land full CRUD in one pass (per the scope decision) so the `onServerAdd` / `onServerEdit` / `onServerClone` / `onServerRemove` stubs in `App.tsx:639` stop lying.

## Non-goals

- Sync with Claude Desktop's `claude_desktop_config.json` location. We pick our own path; symlinking is the user's call.
- Server schema validation beyond what `loadMcpServersConfig` already does (structural; no command-existence check).
- Multi-user / multi-machine sync.
- Migrating CLI/TUI to the default path — they already accept `--config <path>` via `core/mcp/node/config.ts`. The new default-path helper will be in core so they can adopt it later.

## File location

- **Path**: `~/.mcp-inspector/mcp.json` (Windows: `%USERPROFILE%\.mcp-inspector\mcp.json`).
- **Why this dir**: `~/.mcp-inspector/storage/` already exists for the Zustand-persist stores (OAuth, settings); one Inspector dir under `$HOME` is friendlier than two. Resolution uses the same `process.env.HOME || process.env.USERPROFILE` fallback as `getDefaultStorageDir()` in `core/storage/store-io.ts:13`.
- **Why canonical filename**: lets users symlink to/from Claude Desktop and similar tools.
- **Permissions**: `0o600`, matching `writeStoreFile` in `core/storage/store-io.ts:55`.

## On-disk format

```jsonc
{
  "mcpServers": {
    "filesystem-server-default": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "everything-server-default": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

- Matches `MCPConfig` in `core/mcp/types.ts:68`.
- `type` omitted → normalized to `"stdio"`; `type: "http"` → `"streamable-http"` (`normalizeServerType` in `core/mcp/node/config.ts:81`).
- The map key is the **server `id`**. `ServerEntry.id` already documents itself this way (`core/mcp/types.ts:89`: "The MCPConfig.mcpServers map key").
- Display name: derived from the map key. The Inspector adds **no extension fields** to keep `mcp.json` clean and tool-interoperable. The edit dialog therefore treats id and display name as the same field; renaming = key-rotate + carry config across.

## First-run behavior

If the file does not exist when the backend boots, write a file containing the two current `SEED_SERVERS`. User immediately sees a non-empty Servers screen and discovers the file by editing one of the seeds. Subsequent boots read whatever the user has saved.

## Architecture

### Reused

| Concern | File | What we reuse |
|---|---|---|
| Atomic R/W + ENOENT handling + 0o600 + `mkdir -p` | `core/storage/store-io.ts` | `readStoreFile`, `writeStoreFile`, `deleteStoreFile`, `parseStore`, `serializeStore` |
| `mcp.json` parsing + type normalization | `core/mcp/node/config.ts` | `loadMcpServersConfig` (already used by the CLI/TUI runner code); `normalizeServerType` needs to be exported |
| Hono backend + auth + storage routes pattern | `core/mcp/remote/node/server.ts` | `/api/storage/:storeId` is the template for the new `/api/servers` routes |
| Auth'd fetch from browser | wired via `getAuthToken()` in `clients/web/src/App.tsx:84` | `useServers` will call the backend with `x-mcp-remote-auth: Bearer <token>` |

### Why not `createFileStorageAdapter` directly

`core/storage/adapters/file-storage.ts` is a Zustand `persist` adapter — it wraps the payload as `{ state, version }` so the file ends up looking like `{"state":{...},"version":0}`. That breaks the "human-editable canonical `mcp.json`" goal. We use the underlying `store-io.ts` primitives instead.

### New code

#### `core/storage/store-io.ts` (extend)

```ts
export function getDefaultMcpConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "mcp.json");
}
```

Co-located with `getDefaultStorageDir()` so the two path conventions stay in one file.

#### `core/mcp/serverList.ts` (new)

Pure converters between on-disk `MCPConfig` and in-memory `ServerEntry[]`. No I/O — easy to unit-test under happy-dom.

```ts
export function mcpConfigToServerEntries(config: MCPConfig): ServerEntry[];
export function serverEntriesToMcpConfig(entries: ServerEntry[]): MCPConfig;
export function DEFAULT_SEED_CONFIG: MCPConfig; // the two existing seeds
```

`mcpConfigToServerEntries` sets `connection: { status: "disconnected" }` and uses the map key as both `id` and `name`. `serverEntriesToMcpConfig` strips `connection` / `info` (runtime-only) before serializing.

Also re-export `normalizeServerType` from `core/mcp/node/config.ts` (or move it into `serverList.ts` and import it back into `config.ts`).

#### `core/mcp/remote/node/server.ts` (extend)

Add granular endpoints (mirror of `/api/storage/:storeId`, but specialized so the UI can do per-row mutations without read-modify-write across tabs):

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/servers` | — | `{ mcpServers: {...} }` — creates the file with seeds if absent |
| `POST` | `/api/servers` | `{ id: string, config: MCPServerConfig }` | `{ ok: true }`; 409 if `id` already exists |
| `PUT` | `/api/servers/:id` | `{ id?: string, config: MCPServerConfig }` | `{ ok: true }`; supports id rename (delete old key + write new) |
| `DELETE` | `/api/servers/:id` | — | `{ ok: true }` (ignores missing) |

`id` is validated with `validateStoreId` (same alphanum+hyphen+underscore rule as store IDs — prevents anyone slipping `..` into the key). All routes serialize through the same atomic `writeStoreFile`, so concurrent writes are well-defined (last writer wins per-write; granularity reduces blast radius).

`RemoteServerOptions` gains:
```ts
/** Optional path for the user's server list file. Default: ~/.mcp-inspector/mcp.json */
mcpConfigPath?: string;
```

Defaulted via `getDefaultMcpConfigPath()`. `clients/web/server/vite-hono-plugin.ts:62` and `clients/web/server/server.ts:48` get a one-line update to pass `config.mcpConfigPath` if/when the web config grows the field; for v1, the default is sufficient.

#### `core/react/useServers.ts` (new)

```ts
export interface UseServersResult {
  servers: ServerEntry[];
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  addServer: (id: string, config: MCPServerConfig) => Promise<void>;
  updateServer: (originalId: string, newId: string, config: MCPServerConfig) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

export function useServers(opts: {
  baseUrl: string;        // window.location.origin by default in callers
  authToken: string | undefined;
}): UseServersResult;
```

Fetches on mount via `fetch(`${baseUrl}/api/servers`, ...)` with the auth header. Holds the list in `useState`. Mutators do the HTTP call then re-fetch to keep server-and-client in sync (the list is small, ~tens of entries; optimistic merging is not worth the bug surface).

### `clients/web/src/App.tsx` changes

1. Remove the `SEED_SERVERS` constant (seeds move to `core/mcp/serverList.ts` as `DEFAULT_SEED_CONFIG`).
2. Replace `const [servers] = useState<ServerEntry[]>(SEED_SERVERS);` with `const { servers, addServer, updateServer, removeServer } = useServers({ baseUrl: window.location.origin, authToken: getAuthToken() });`.
3. Wire `onServerAdd` / `onServerEdit` / `onServerClone` / `onServerRemove` (currently `todoNoop` at `clients/web/src/App.tsx:639`–`646`) to the hook.
4. Disconnect-on-remove: if the user removes the `activeServerId`, call `inspectorClient?.disconnect()` and clear active server state before the mutation. Matches the lifecycle the `useEffect` at `App.tsx:272` already enforces on unmount.
5. Active-server pinning across rename: `updateServer` returns the new id; if `originalId === activeServerId`, update `activeServerId` to the new id.

### UI surfaces

The `InspectorView` prop interface already declares `onServerAdd` / `onServerEdit` / `onServerClone` / `onServerRemove` / `onServerImportConfig` / `onServerImportJson`. The dialogs themselves are TBD — out of scope for *this* spec is the visual design; in scope is wiring them to the new hook. If the Add/Edit dialog component does not exist yet, ship a minimal Mantine `Modal` + `TextInput` + transport-specific fields. Follow `clients/web/src/components/...` conventions (subcomponent constants via `.withProps()`, theme variants for styling — per `AGENTS.md`'s React rules).

`onServerImportConfig` / `onServerImportJson` map naturally to "paste a full `mcpServers` block" and "upload an `mcp.json` file"; both become bulk `POST /api/servers` calls in a loop (or a single `PUT /api/servers` that we add later). Defer until basic add/edit/remove is working.

## Test plan

Place tests per `AGENTS.md`'s integration-folder convention.

### Unit (`unit` vitest project, happy-dom)

- `clients/web/src/test/core/mcp/serverList.test.ts` — round-trip `MCPConfig` ↔ `ServerEntry[]`; verifies the map key becomes the id, that `connection` / `info` are stripped on serialize, and that `normalizeServerType` is applied on parse.
- `clients/web/src/test/core/storage/getDefaultMcpConfigPath.test.ts` — env-var permutations (`HOME` set / `USERPROFILE` set / neither).

### Integration (`integration` vitest project, node env, 30s)

- `clients/web/src/test/integration/mcp/remote/servers-route.test.ts` — spin up `createRemoteApp` with a tmp `mcpConfigPath`, exercise GET (file absent → seeds written; file present → returned), POST (success + 409 on dup), PUT (rename + payload update), DELETE (existing + missing). Mirrors the `adapters.test.ts` pattern already in `clients/web/src/test/integration/storage/adapters.test.ts`.
- `clients/web/src/test/integration/react/useServers.test.tsx` — render the hook against a real `createRemoteApp` Hono instance (no mocking); assert load, add, update, remove flows reflect what the backend has on disk.

### Coverage

The 90% per-file gate applies to the new files. The pure converters and route handlers are easy; the React hook's error path needs explicit coverage (network error, 4xx response, 5xx response).

### Manual

Per `AGENTS.md`'s "test new or modified code" rule plus the UI-changes guidance: run `npm run dev`, verify (a) first launch writes the seeds, (b) editing the file by hand and reloading the browser shows the edit, (c) Add/Edit/Remove from the UI persist across a hard reload, (d) deleting the active server cleanly disconnects.

## Risks

- **Concurrent writes from multiple browser tabs.** Granular endpoints reduce the surface (per-row, not whole-file). Same-row contention is last-write-wins, which is fine for a config the user is editing manually. We do *not* add file locking; the cost outweighs the rare case.
- **User edits the file while the browser is open.** Browser holds a stale list until the user hits Refresh on the Servers screen (the `refresh` returned by the hook). Acceptable for v1; auto-watching the file is a possible follow-up but `fs.watch` semantics across OSes are a long tail of bugs.
- **Schema drift with Claude Desktop / Cursor.** They occasionally add fields (e.g. Claude Desktop's `disabled`). `loadMcpServersConfig` currently does `JSON.parse(...) as MCPConfig` — extra fields survive the round-trip as long as we don't filter them. The converters in `serverList.ts` should preserve unknown fields on `MCPServerConfig` rather than copying a fixed allow-list.
- **Migration from `SEED_SERVERS`.** Existing dev users have no file. First boot writes one — they won't notice. No code path persists the in-memory `useState` list today, so nothing to migrate.

## Per-server settings (#1352)

Each server entry may carry an optional `settings` node alongside the transport config:

```jsonc
{
  "mcpServers": {
    "my-server": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "settings": {
        "headers":  [{ "key": "Authorization", "value": "Bearer xxx" }],
        "metadata": [{ "key": "tenant",        "value": "acme" }],
        "connectionTimeout": 30000,
        "requestTimeout":    60000,
        "oauthClientId":     "...",
        "oauthClientSecret": "...",
        "oauthScopes":       "read:tools write:tools"
      }
    }
  }
}
```

- **Shape**: `InspectorServerSettings` in `core/mcp/types.ts`. The `settings` field on `StoredMCPServer` (also in `types.ts`) is the on-disk extension; other MCP tools (Claude Desktop, Cursor, Cline) ignore unknown fields.
- **Where it takes effect**:
  - `settings.headers` → wire headers on every SSE / streamable-http request (`core/mcp/node/transport.ts`).
  - `settings.metadata` → default `_meta` payload merged into every outgoing MCP request (`core/mcp/inspectorClient.ts`'s `mergeMeta` helper). Per-call metadata wins on key collision.
  - `settings.requestTimeout` → `InspectorClientOptions.timeout`.
  - `settings.connectionTimeout` → `Promise.race` wrapper around `InspectorClient.connect()` in the web client.
  - `settings.oauthClientId` / `oauthClientSecret` / `oauthScopes` → pre-seeded OAuth client credentials via `InspectorClientOptions.oauth`.
- **First-connect contract**: settings apply on the *first* outbound request after the entry loads from disk — no need to open the settings form. The browser sends `settings` to the backend in the `/api/mcp/connect` body; the backend reads it from `RemoteConnectRequest` and threads it into `createTransportNode`.
- **Secret storage**: `oauthClientSecret` is persisted in `mcp.json` alongside stdio `env` values, both protected by the file's `0o600` permission. OS-keychain integration is out of scope; a follow-up may switch the layout if a stronger secret store is needed.
- **Removed**: `MCPServerConfig.headers` (previously on `SseServerConfig` / `StreamableHttpServerConfig`) has been deleted. The headers textarea in `ServerConfigModal` is gone; HTTP headers are entered only in `ServerSettingsForm`. v2 has not shipped a stable release with the old shape, so no on-read migration is included.
- **UI**: `ServerSettingsModal` is opened from the server card's settings affordance; saving routes through `useServers.updateServerSettings(id, settings)` which calls `PUT /api/servers/:id` with `{ id, config, settings }`. `useServers.updateServer` re-sends the existing settings whenever it issues a PUT so the config-modal save does not clobber persisted settings.

## Out of scope (follow-ups)

- Import-from-Claude-Desktop button (read `~/Library/Application Support/Claude/claude_desktop_config.json` or the Windows/Linux equivalent, merge into our file).
- File watching for hot reload of external edits.
- Per-server tags / folders / groups.
- Export current list as JSON.
- CLI/TUI: switch their default `--config` to `getDefaultMcpConfigPath()` when no `--config` flag is given. Touch when those clients are wired up to v2. While porting, re-add a `--header` flag that writes to `settings.headers` rather than to `MCPServerConfig`.
