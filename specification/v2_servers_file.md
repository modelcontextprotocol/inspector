# Inspector V2 Tech Stack - Storage - Server List File

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [Web Client](v2_web_client.md) | [CLI, TUI, Launcher](v2_cli_tui_launcher.md) | [Server](v2_server.md) | Storage

##### [Overview](v2_storage.md) | Server List File

## Summary

Replaces the hardcoded `SEED_SERVERS` in `clients/web/src/App.tsx:47` with a file-backed list at `~/.mcp-inspector/mcp.json`, read at startup, mutated via REST endpoints, surfaced through a `useServers` hook. The file also stores the per-server **settings** (custom headers, request metadata, timeouts, pre-configured OAuth credentials) edited by `ServerSettingsForm` — see [Per-server settings](#per-server-settings-1352) below for the on-disk shape, UI rationale, and write/read invariants. Post-#1358 those settings fields live as direct keys on the entry (matching the Claude Code / Cursor / Cline `.mcp.json` convention) rather than under a nested `settings` block.

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
- **Why this dir**: `~/.mcp-inspector/storage/` already holds runtime persistence files (OAuth tokens, install `client.json`, etc.); one Inspector dir under `$HOME` is friendlier than two. Resolution uses the same `process.env.HOME || process.env.USERPROFILE` fallback as `getDefaultStorageDir()` in `core/storage/store-io.ts:13`.
- **Why canonical filename**: lets users symlink to/from Claude Desktop and similar tools.
- **Permissions**: `0o600`, matching `writeStoreFile` in `core/storage/store-io.ts:55`.

## On-disk format

```jsonc
{
  "mcpServers": {
    "filesystem-server-default": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    "everything-server-default": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
    },
    "acme-api": {
      "type": "streamable-http",
      "url": "https://api.acme.example/mcp",
      // Inspector-extension fields (post-#1358) live as direct keys on the
      // entry, matching the Claude Code / Cursor / Cline `.mcp.json`
      // convention. See [Per-server settings](#per-server-settings-1352)
      // for the full contract; the in-memory + wire shape keeps pair-array
      // headers and flat oauth* fields for the form's controlled-component
      // editing.
      "headers": { "X-Tenant": "acme" },
      "metadata": [{ "key": "trace", "value": "abc" }],
      "connectionTimeout": 30000,
      "requestTimeout": 60000,
      "oauth": {
        "clientId": "client-abc",
        "scopes": "read:tools write:tools",
      },
    },
  },
}
```

- Matches `MCPConfig` in `core/mcp/types.ts:68`.
- `type` omitted → normalized to `"stdio"`; `type: "http"` → `"streamable-http"` (`normalizeServerType` in `core/mcp/node/config.ts:81`).
- The map key is the **server `id`**. `ServerEntry.id` already documents itself this way (`core/mcp/types.ts:89`: "The MCPConfig.mcpServers map key").
- Display name: derived from the map key. The edit dialog treats id and display name as the same field; renaming = key-rotate + carry config across.
- Each entry may optionally carry Inspector-extension fields (`headers`, `metadata`, `connectionTimeout`, `requestTimeout`, `oauth`) as direct keys on the entry — post-#1358 these are no longer nested under a `settings` wrapper. The `headers` and `oauth` shapes match the Claude Code / Cursor / Cline `.mcp.json` convention, so a file written by any of those tools is loadable on first connect. `metadata` / `connectionTimeout` / `requestTimeout` are Inspector-only and other tools simply ignore them.

## First-run behavior

If the file does not exist when the backend boots, write a file containing the two current `SEED_SERVERS`. User immediately sees a non-empty Servers screen and discovers the file by editing one of the seeds. Subsequent boots read whatever the user has saved.

## Architecture

### Reused

| Concern                                           | File                                                       | What we reuse                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Atomic R/W + ENOENT handling + 0o600 + `mkdir -p` | `core/storage/store-io.ts`                                 | `readStoreFile`, `writeStoreFile`, `deleteStoreFile`, `parseStore`, `serializeStore`                         |
| `mcp.json` parsing + type normalization           | `core/mcp/node/config.ts`                                  | `loadMcpServersConfig` (already used by the CLI/TUI runner code); `normalizeServerType` needs to be exported |
| Hono backend + auth + storage routes pattern      | `core/mcp/remote/node/server.ts`                           | `/api/storage/:storeId` is the template for the new `/api/servers` routes                                    |
| Auth'd fetch from browser                         | wired via `getAuthToken()` in `clients/web/src/App.tsx:84` | `useServers` will call the backend with `x-mcp-remote-auth: Bearer <token>`                                  |

### Why not a `{ state, version }` envelope for `mcp.json`

Older OAuth persistence used a middleware-style envelope `{ state, version }` around the payload. That shape is fine for opaque runtime blobs like `oauth.json` (still accepted on **read** for migration — see [OAuth persistence](v2_auth_ema.md#oauth-persistence-1549--done)) but breaks the goal of a **human-editable canonical `mcp.json`**. Server list I/O uses the underlying `store-io.ts` primitives and writes plain JSON.

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

| Method   | Path               | Body                                       | Response                                                                                                        |
| -------- | ------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/servers`     | —                                          | `{ mcpServers: {...} }` — creates the file with seeds if absent                                                 |
| `POST`   | `/api/servers`     | `{ id: string, config: MCPServerConfig }`  | `{ ok: true }`; 409 if `id` already exists                                                                      |
| `PUT`    | `/api/servers/:id` | `{ id?: string, config: MCPServerConfig }` | `{ ok: true }`; supports id rename (rewrites `mcpServers` key; migrates keychain secrets — see §Secret storage) |
| `DELETE` | `/api/servers/:id` | —                                          | `{ ok: true }` (ignores missing)                                                                                |

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
  updateServer: (
    originalId: string,
    newId: string,
    config: MCPServerConfig,
  ) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

export function useServers(opts: {
  baseUrl: string; // window.location.origin by default in callers
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

The `InspectorView` prop interface already declares `onServerAdd` / `onServerEdit` / `onServerClone` / `onServerRemove` / `onServerImportConfig` / `onServerImportJson`. The dialogs themselves are TBD — out of scope for _this_ spec is the visual design; in scope is wiring them to the new hook. If the Add/Edit dialog component does not exist yet, ship a minimal Mantine `Modal` + `TextInput` + transport-specific fields. Follow `clients/web/src/components/...` conventions (subcomponent constants via `.withProps()`, theme variants for styling — per `AGENTS.md`'s React rules).

`onServerImportConfig` / `onServerImportJson` map naturally to "paste a full `mcpServers` block" and "upload an `mcp.json` file"; both become bulk `POST /api/servers` calls in a loop (or a single `PUT /api/servers` that we add later). Defer until basic add/edit/remove is working.

## Test plan

Place tests per `AGENTS.md`'s integration-folder convention.

### Unit (`unit` vitest project, happy-dom)

- `clients/web/src/test/core/mcp/serverList.test.ts` — round-trip `MCPConfig` ↔ `ServerEntry[]`; verifies the map key becomes the id, that `connection` / `info` are stripped on serialize, and that `normalizeServerType` is applied on parse.
- `clients/web/src/test/core/storage/getDefaultMcpConfigPath.test.ts` — env-var permutations (`HOME` set / `USERPROFILE` set / neither).

### Integration (`integration` vitest project, node env, 30s)

- `clients/web/src/test/integration/mcp/remote/servers-route.test.ts` — spin up `createRemoteApp` with a tmp `mcpConfigPath`, exercise GET (file absent → seeds written; file present → returned), POST (success + 409 on dup), PUT (rename + payload update + keychain secret migration on rename), DELETE (existing + missing). Mirrors the `adapters.test.ts` pattern already in `clients/web/src/test/integration/storage/adapters.test.ts`.
- `clients/web/src/test/integration/react/useServers.test.tsx` — render the hook against a real `createRemoteApp` Hono instance (no mocking); assert load, add, update, remove flows reflect what the backend has on disk.

### Coverage

The 90% per-file gate applies to the new files. The pure converters and route handlers are easy; the React hook's error path needs explicit coverage (network error, 4xx response, 5xx response).

### Manual

Per `AGENTS.md`'s "test new or modified code" rule plus the UI-changes guidance: run `npm run dev`, verify (a) first launch writes the seeds, (b) editing the file by hand and reloading the browser shows the edit, (c) Add/Edit/Remove from the UI persist across a hard reload, (d) deleting the active server cleanly disconnects.

## Risks

- **Concurrent writes from multiple browser tabs.** Granular endpoints reduce the surface (per-row, not whole-file). Same-row contention on `mcp.json` is last-write-wins, which is fine for a config the user is editing manually. We do _not_ lock `mcp.json`; the cost outweighs the rare case. The _secrets_ file is a separate question with a separate answer — see [Secret storage](#secret-storage-1356) — because losing a write there loses a credential rather than a preference.
- **User edits the file while the browser is open.** Browser holds a stale list until the user hits Refresh on the Servers screen (the `refresh` returned by the hook). Acceptable for v1; auto-watching the file is a possible follow-up but `fs.watch` semantics across OSes are a long tail of bugs.
- **Schema drift with Claude Desktop / Cursor.** They occasionally add fields (e.g. Claude Desktop's `disabled`). `loadMcpServersConfig` currently does `JSON.parse(...) as MCPConfig` — extra fields survive the round-trip as long as we don't filter them. The converters in `serverList.ts` should preserve unknown fields on `MCPServerConfig` rather than copying a fixed allow-list.
- **Migration from `SEED_SERVERS`.** Existing dev users have no file. First boot writes one — they won't notice. No code path persists the in-memory `useState` list today, so nothing to migrate.

## Per-server settings (#1352, flattened in #1358)

Our UI design separates the basic server configuration (transport, URL or command + args + env) from settings (custom headers, connect/request timeout, global request metadata, client id/secret) into two dialogs. The reason they're separated in the UI is that custom settings are less likely to be needed than basic config, so a simpler, friendlier form greets most users.

#1352 originally persisted these settings under a nested `settings` block on each entry. #1358 flattens them onto the entry as direct keys, so the on-disk shape matches the `.mcp.json` convention Claude Code / Cursor / Cline use (`headers` as a `Record<string, string>`, `oauth` as a nested object). The in-memory + wire shape is unchanged: `InspectorServerSettings` keeps pair-array `headers` and flat `oauthClientId` / `oauthClientSecret` / `oauthScopes` because the form needs them in that shape for controlled-component editing.

Each server entry may carry these Inspector-extension fields at the top level:

```jsonc
{
  "mcpServers": {
    "my-server": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer xxx" },
      "metadata": [{ "key": "tenant", "value": "acme" }],
      "connectionTimeout": 30000,
      "requestTimeout": 60000,
      "oauth": {
        "clientId": "...",
        "clientSecret": "...",
        "scopes": "read:tools write:tools",
      },
    },
  },
}
```

- **Shape**:
  - On disk (`StoredMCPServer` in `core/mcp/types.ts`): `headers` as `Record<string, string>`, `metadata` as a pair-array (Inspector-only — no compat target), numeric timeouts, `oauth` as a nested `{ clientId?, clientSecret?, scopes? }` object. Every field optional; absent fields are omitted on disk so the file diff stays minimal.
  - In memory + on the wire (`InspectorServerSettings` in `core/mcp/types.ts`): `headers` as a pair-array `{ key, value }[]`, flat `oauthClientId` / `oauthClientSecret` / `oauthScopes` fields, required `metadata` (pair-array) + required numeric `connectionTimeout` / `requestTimeout` (the form needs concrete values to render; 0 is the SDK's "no timeout" signal).
  - The bidirectional conversion lives in `core/mcp/serverList.ts` (`storedFieldsToInspectorSettings` / `inspectorSettingsToStoredFields`) and is invoked by `mcpConfigToServerEntries` / `serverEntriesToMcpConfig` and by the server route's `buildStoredEntry`.
- **Where it takes effect**:
  - `headers` → wire headers on every SSE / streamable-http request (`core/mcp/node/transport.ts` consumes the pair-array via `InspectorServerSettings.headers`).
  - `metadata` → default `_meta` payload merged into every outgoing MCP request (`core/mcp/inspectorClient.ts`'s `mergeMeta` helper). Per-call metadata wins on key collision.
  - `requestTimeout` → `InspectorClientOptions.timeout`.
  - `connectionTimeout` → `Promise.race` wrapper around `InspectorClient.connect()` in the web client.
  - `oauth.clientId` / `oauth.clientSecret` / `oauth.scopes` → pre-seeded OAuth client credentials via `InspectorClientOptions.oauth` (the disk-side `oauth` object is lifted into the flat `oauthClientId` / etc. fields on `InspectorServerSettings` for the form).
- **First-connect contract**: settings apply on the _first_ outbound request after the entry loads from disk — no need to open the settings form. The browser sends `settings` to the backend in the `/api/mcp/connect` body; the backend reads it from `RemoteConnectRequest` and threads it into `createTransportNode`.
- **Secret storage (#1356)**: `oauth.clientSecret` and stdio `env` values are persisted in the OS keychain (macOS Keychain Services / Windows Credential Manager / Linux libsecret via `@napi-rs/keyring`), keyed by `(serverId, field)` under the service name `mcp-inspector`. Field names: `oauth-client-secret`, `env:<KEY>` (one per stdio env variable). The on-disk `mcp.json` is stripped of these values — `oauth.clientSecret` is omitted entirely, stdio env keys are preserved with empty-string placeholders (`"env": { "API_KEY": "" }`) so the file still documents the env interface the server expects. The wire shape returned by `GET /api/servers` is unchanged from before #1356: the handler rehydrates values from the keychain so browser code sees the same JSON it has always seen. **TUI/CLI rehydration:** the shared `loadServerEntries()` path (`core/mcp/node/servers.ts`) calls `rehydrateMcpConfigFromKeychain()` (`core/mcp/node/server-secrets.ts`) after reading `mcp.json`, so runner clients see the same effective OAuth client secrets and stdio env values as the web catalog list. This path is read-only — it does not migrate plaintext secrets into the keychain (that remains the web `GET /api/servers` migration sweep). The keychain interactions live in `core/auth/node/secret-store.ts` behind a `SecretStore` interface. As of #1950 there are **three** implementations — `KeyringSecretStore`, `FileSecretStore`, `InMemorySecretStore` — chosen per run by `core/auth/node/secret-store-selection.ts`; the integration suite still injects one directly via `RemoteServerOptions.secretStore`.
  - **Migration**: on every `GET /api/servers`, the handler walks the freshly-read config and, for any entry that still carries plaintext secrets (older Inspector builds, hand-edited files, files imported from another tool), lifts each value into **the selected secret store** and rewrites the file with the stripped shape. The migration is idempotent — when the store already holds a value for `(serverId, field)`, the store wins and the disk plaintext is dropped unread.
    - **Post-#1950 the rewrite is gated on durability.** The disk copy is stripped only once the value is somewhere that outlives the process (`secretStoreIsDurable`). Against the session-scoped in-memory store — the container fallback — stripping would trade a secret that survives restarts for one that dies with the process, and because this runs on an ordinary `GET`, merely opening the app would destroy it. The values are still loaded into the store, so the session behaves normally; only the delete is withheld, and a one-line warning says so.
    - **The "keychain wins" lookup uses the strict read.** `get` is tolerant by contract, so a transient store failure answers `null` — and this branch _writes_ on `null` and then strips the disk copy, which would let an older on-disk value replace a newer stored one. `secretStoreGetStrict` throws instead, and the migration abandons rather than writing on an answer it cannot trust.
  - **Linux without libsecret**: every `SecretStore` shares one _tolerance contract_ — `get` returns `null`, the destructive operations silently no-op, and only `set` hard-fails (with a `SecretStoreUnavailableError`, translated to a `503`). So no-secret flows (creating a stdio server with no env values, deleting an entry, reading the list, the defensive sweep on POST) work normally on a box with no reachable keychain. **Since #1950 that is no longer the end of the story**: a host without a keychain now falls back to a file or in-memory store rather than being unable to persist a secret at all — see [Secret store selection (#1950)](#secret-store-selection-1950).
  - **Migration tolerance**: when migration encounters a `SecretStoreUnavailableError` — `KeychainUnavailableError` is one subclass, and the file store raises its own for an unreadable file, a changed passphrase or a write failure — the GET handler logs a warning, leaves the on-disk plaintext untouched, and serves the (still-plaintext) response. Subsequent reads retry, so installing libsecret (or restoring the passphrase) lifts the secrets on the next GET with no user action. Partial-migration semantics are deliberate: if `set` threw partway through the loop the handler returns the _original_ config rather than the partially-rewritten one, so the disk file stays intact and the idempotent store-wins branch absorbs the already-written entries on retry.
  - **Write ordering on POST/PUT**: keychain writes happen before the disk write, and obsolete-field deletions happen after. The intent is that a `set` failure (the only hard-fail path) leaves both stores in their pre-write state — no half-applied entry on disk that would trap a retry POST at `409`, and no premature deletion of an obsolete field whose disk write later fails.
  - **Id rename (`PUT` with new `id`)**: secrets are keyed by **server id** (the `mcpServers` map key), not URL. On rename the handler reads existing keychain entries for the **original** id (`expectedSecretFields` + `readKeychainEntriesFor`), merges them with any secrets in the PUT body (body wins on conflict), filters to fields the **new** on-disk entry still expects (so removed stdio env keys are not carried over), writes under the **new** id, updates disk, then `deleteAllForServer(originalId)`. This matters for config-only renames (e.g. Server Config modal) that do not re-send OAuth client secrets or stdio env values — those live only in the keychain after #1356. Covered by `servers-route.test.ts` (`PUT rename moves … when it exists only in the keychain` for OAuth and stdio env).
  - **Out of scope for this PR**: the OAuth handshake itself still runs in the browser via the MCP SDK, so during the token exchange the secret transits the wire (browser → MCP SDK → OAuth provider's token endpoint). The on-disk win this PR delivers is that the secret is no longer in the shareable / symlinked `mcp.json` and is no longer the source-of-truth on the filesystem. Moving the token exchange to the Node side is tracked separately.
- **Secret store selection (#1950)**: #1356 assumed a keychain. On a host without one — the published container (no D-Bus session, #1848), Android/Termux (no prebuilt binary, #1905), a minimal Linux install — `set` hard-failed, so those users could not persist an OAuth client secret or a stdio `env:` value **at all**. #1950 adds the two missing implementations plus the policy that picks one, and the surfaces that say which was picked.
  - **Selection**: `MCP_INSPECTOR_SECRET_STORE=keyring|file|memory` wins outright. Otherwise the keychain is _probed_ — an `AsyncEntry` construction plus a real read, because the container that motivated #1848 imports the package fine and only fails when it reaches for a Secret Service that isn't there. A read and not a write, deliberately: probing by writing would deposit a value in the user's login keyring at every startup for a store they may never use. If the probe fails the fallback is **`memory`** in a container whose secrets directory is not on a mount, and **`file`** otherwise — so mounting the volume the README already recommends for the catalog flips the same run to durable storage with no configuration, and an unmounted container gets the honest answer rather than a file `docker run --rm` will discard. Resolution is cached per process so the startup banner, `GET /api/config`, and the store doing the writing cannot disagree.
  - **`FileSecretStore` at rest**: one JSON document at `~/.mcp-inspector/secrets.json` (or `MCP_INSPECTOR_SECRET_FILE`, else under `MCP_STORAGE_DIR`), written `0600` and re-tightened at startup. With `MCP_INSPECTOR_SECRET_KEY` set it is AES-256-GCM with a scrypt-derived key and a per-write random salt; without it the values are in the clear, and _that_ is what the loud banner and the warning-toned modal footer are about. The **whole map is encrypted as a unit**, not value-by-value, so the account names (`serverId:field`) are hidden too — a per-value scheme would leave a readable index of which servers you hold a client secret for. Upgrading is lazy: setting the passphrase later re-encrypts on the next write rather than rewriting the file during a run that may never touch a secret, and the descriptor reports `pendingEncryption` until it does. A file that can no longer be decrypted reads as empty but **refuses to be written**, because replacing a file of still-valid secrets to satisfy an additive request destroys data.
  - **Concurrency, and what it does not promise**: within a process, mutations are serialized per **resolved file path** (not per store instance — two `FileSecretStore`s on one file are ordinary, since the resolved store holds one and the keychain hand-off builds another). Across processes there is **no lock**. An earlier iteration had a `mkdir` election with an owner stamp, heartbeat and stale-takeover; three review rounds each found a real race, and the last is not closable with what Node exposes — claiming a stale lock needs compare-and-swap on a directory entry (`renameat2(RENAME_EXCHANGE)`). It was replaced with optimistic concurrency: read `M0`, apply, write `M1`, read back `M2`, and re-apply onto whatever a concurrent writer left if they differ, bounded, with `set` throwing on non-convergence rather than returning as though the value were saved. The comparison is over the **whole map** — checking only your own entry passes in exactly the case that loses data, because yours is present and the other writer's is gone. **This is not mutual exclusion.** The verify only catches a clobber that has already landed, so ordering the two writers write-A / verify-A / write-B / verify-B leaves both reporting success with A's entry gone — A's verify ran before there was anything to see. A crash between write and verify is one instance of that shape, not the whole of it. The window is narrower than the lock's (which lost updates across a wider set of interleavings, with every participant alive) and needs no primitive Node lacks, but it is a real residual and is documented as one. If a deployment needs the guarantee, the answer is an OS-backed lock from a dedicated library, not another hand-rolled election.
  - **Strict reads (`getStrict`)**: `get` is tolerant by contract, and that tolerance is wrong for exactly one caller — a migration that treats `null` as proof of absence and then _writes_. A transient read failure would look like "nothing there", and the write would replace a newer stored value with an older on-disk copy, inverting the keychain-wins rule the migration is built on. `getStrict` throws instead, and both plaintext migrations plus the keychain hand-off use it. Two traps this hit on the way in, both worth remembering: the seam must be forwarded by `DeferredSecretStore` (the store production actually uses, so without forwarding the strictness existed only in tests that injected a concrete store), and it must be implemented by _every_ store rather than falling back to `get` for the one it was introduced for.
  - **Bulk reads (`getMany`)**: rehydration asks field by field, and `FileSecretStore.get` reads and decrypts the entire file per call. scrypt at `N=16384` measures ~23ms, so a 20-secret encrypted catalog spent ~450ms of pure key derivation on every `GET /api/servers` — a visible stall rather than a micro-optimization. `getMany` decrypts once per server; stores for which per-field reads are already cheap fall back to parallel `get`.
  - **Durability gate on migration**: the plaintext-stripping migrations only delete the disk copy once the value is somewhere that outlives the process (`isDurable`). Against a session-scoped store, stripping would trade a secret that survives restarts for one that dies with the process — and it runs on an ordinary `GET`, so merely opening the app would destroy it.
  - **Hand-off when a keychain appears**: install libsecret after storing secrets in a file, and the next run selects the keychain and stops seeing them — still on disk, read by nothing, nothing visibly broken. `absorbFileSecretsIntoKeyring` copies them over on that run, under the same keychain-wins rule, and deletes the file **only** on complete success. Since the store takes no lock, the delete is conditional: the file is re-read immediately beforehand and compared against what was copied, and the delete is declined when they differ, because another process may have added an entry that was never copied.
  - **Surfacing it**: the active store rides `GET /api/config` as a `secretStorage` descriptor and is stated in a permanent footer at the bottom of the Client Settings and Server Settings modals — the only two dialogs that accept a secret. A startup banner is seen once by whoever started the process; a toast is seen once; a dismissible banner is by design the thing a user dismisses before doing the work it describes. The descriptor is re-derived per request rather than cached, because `plaintext`/`pendingEncryption` describe bytes this very process changes.

- **Hard-cutover legacy behavior (per #1358 decision 4)**: files written by the one pre-#1358 build of v2/main have a nested `settings` block. `normalizeMcpServers` drops the node on read and logs a one-line warn including the server id; the persisted headers / metadata / timeouts / OAuth credentials are intentionally lost on first read. Users re-enter them via the settings form (or hand-edit the file into the flat shape). v2 has not shipped a stable release with the nested shape, so the blast radius is the small set of v2/main dogfooders who edited per-server settings between #1353 merging and this change.
- **UI**: `ServerSettingsModal` is opened from the server card's settings affordance. Saving routes through `useServers.updateServerSettings(id, settings)` which issues a settings-only `PUT /api/servers/:id` with `{ id, settings }` — the route preserves the on-disk transport config inside its write lock. Conversely, `useServers.updateServer` (driven by the basic-config modal) issues a config-only PUT with `{ id, config }` and the route preserves the on-disk settings fields. Edits in either modal cannot silently wipe the other half.
- **Save cadence**: the form fires `onSettingsChange` on every keystroke. `App.tsx` debounces 300 ms and flushes on modal close so a burst of edits coalesces into a single PUT. If the close-flush PUT fails (network hiccup, server 500), a red `@mantine/notifications` toast surfaces the failure — the modal has already closed so a silent failure would leave the user thinking the last edits saved.
- **`PUT /api/servers/:id` patch semantics (kept-envelope wire shape per #1358 decision 5)**: both `config` and `settings` are independent patches on the wire, even though the on-disk shape has no `settings` wrapper. The envelope-on-the-wire keeps the preserve/clear/apply semantics #1353 introduced — the backend splats validated `settings.*` into top-level disk keys when assembling the next on-disk shape.
  - Field omitted → preserve the on-disk value.
  - Explicit `null` on `settings` → clear all Inspector-extension fields on disk (`headers` / `metadata` / `connectionTimeout` / `requestTimeout` / `oauth`). (`config` may not be `null`; a body that wants to update only settings should omit `config` entirely.)
  - Field present and well-formed → validate and apply.
  - A bare `PUT { id: "renamed" }` is a pure rename preserving both halves.
- **Write-path gates**: `validateSettings` rejects malformed shapes (non-object, wrong-typed `headers` / `metadata`, non-numeric timeouts) with `400` + descriptive message and picks-and-builds the validated value so unknown stowaway keys silently drop. `buildStoredEntry` strips any of the Inspector-extension keys (`settings`, `headers`, `metadata`, `connectionTimeout`, `requestTimeout`, `oauth`) smuggled inside the incoming `config` and logs a `warn` with the server id, so the wire envelope's `settings` field remains the only path those values reach disk.
- **Read-path gates**: `normalizeMcpServers` passes the entry's flat Inspector-extension fields through verbatim — the form's `storedFieldsToInspectorSettings` does the lift into the in-memory pair-array / flat-OAuth shape. A legacy nested `settings` block triggers the hard-cutover drop described above.

## Out of scope (follow-ups)

- Import-from-Claude-Desktop button (read `~/Library/Application Support/Claude/claude_desktop_config.json` or the Windows/Linux equivalent, merge into our file).
- File watching for hot reload of external edits.
- Per-server tags / folders / groups.
- Export current list as JSON.
- CLI/TUI: switch their default `--config` to `getDefaultMcpConfigPath()` when no `--config` flag is given. Touch when those clients are wired up to v2. While porting, re-add a `--header` flag that writes to the entry's top-level `headers` field on disk (post-#1358 flat shape) rather than to `MCPServerConfig`.
