# MCP Inspector TUI Client

The Terminal User Interface (TUI) client brings the interactive exploration capabilities of the Web Client directly to your terminal. It is built using [Ink](https://github.com/vadimdemedes/ink) to provide a rich, React-like component experience in a command-line environment.

![MCP Inspector TUI Screenshot](../../docs/images/tui-screenshot.png)

## Running the TUI

You can run the TUI client via `npx`:

```bash
npx @modelcontextprotocol/inspector --tui node build/index.js
```

### With Configuration Files

The TUI can load all servers from an MCP catalog/config file. With no source
flag it uses the default writable catalog `~/.mcp-inspector/mcp.json` (seeded
empty if missing):

```bash
npx @modelcontextprotocol/inspector --tui --catalog mcp.json   # writable catalog (seeded empty if missing)
npx @modelcontextprotocol/inspector --tui --config mcp.json    # read-only session (errors if absent)
```

(It does not use `--server`; all servers in the file are available in the TUI.)

## Options

### MCP server (which server(s) to connect to)

Options that specify the MCP server(s) (catalog/config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--catalog` (writable catalog, seeded **empty** if missing; default `~/.mcp-inspector/mcp.json` or `MCP_CATALOG_PATH`), `--config` (read-only session, errors if absent), `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`. `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target.

### TUI-specific (OAuth for HTTP servers)

The TUI supports OAuth for **SSE** and **Streamable HTTP** servers. Per-server OAuth fields in `mcp.json` (static client id/secret, scopes, enterprise-managed flag) are applied automatically when loaded from `--catalog` or `--config`. Install-wide settings (CIMD, enterprise IdP) come from **`~/.mcp-inspector/storage/client.json`** — the same file the web **Client Settings** dialog writes. You can point at a different file with `--client-config` or `MCP_CLIENT_CONFIG_PATH`.

#### OAuth callback URL

The TUI starts a small loopback HTTP server to receive the authorization redirect after you sign in in the browser. Defaults:

| Surface | Default callback                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------- |
| **Web** | `http://localhost:6274/oauth/callback` (main app server)                                          |
| **TUI** | `http://127.0.0.1:6276/oauth/callback` (dedicated runner port; avoids colliding with web on 6274) |

**Why a fixed default port?** Enterprise-managed auth (EMA), CIMD, and many static OAuth apps require **pre-registered redirect URIs**. A predictable default (`http://127.0.0.1:6276/oauth/callback`) lets you register once on the IdP and reuse it across TUI sessions. Dynamic registration (DCR) can use ephemeral ports instead — see below.

**Trade-off:** only **one TUI OAuth flow at a time** can listen on the default port. A second instance starting OAuth while another is in progress may fail with `EADDRINUSE`. Override the listener with `--callback-url` or `MCP_OAUTH_CALLBACK_URL` (e.g. a different fixed port per instance, or `http://127.0.0.1:0/oauth/callback` when the authorization server accepts dynamically registered redirect URIs).

OAuth redirect URIs must match **exactly** what you register on the authorization server — `localhost` and `127.0.0.1` are different URIs. Register the TUI default on your OAuth app / IdP when using pre-registered (static), CIMD, or enterprise-managed clients. Override the listener with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`; use `http://127.0.0.1:0/oauth/callback` for an OS-assigned ephemeral port when the authorization server registers redirect URIs dynamically (DCR).

#### Flags

| Option                        | Env                      | Description                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--client-config <path>`      | `MCP_CLIENT_CONFIG_PATH` | Install-level client config (default: `~/.mcp-inspector/storage/client.json`).                                                                                                                                                                                        |
| `--client-id <id>`            | —                        | OAuth client ID (static client); overrides `client.json`.                                                                                                                                                                                                             |
| `--client-secret <secret>`    | —                        | OAuth client secret (confidential clients); overrides `client.json`.                                                                                                                                                                                                  |
| `--client-metadata-url <url>` | —                        | Client ID Metadata Document URL (CIMD); overrides `client.json`.                                                                                                                                                                                                      |
| `--callback-url <url>`        | `MCP_OAUTH_CALLBACK_URL` | OAuth redirect/callback listener (default: `http://127.0.0.1:6276/oauth/callback`). Must bind a **loopback** host (`localhost` / `127.0.0.0/8` / `[::1]`); a non-loopback host hard-errors, since the listener receives the authorization code over plaintext `http`. |

#### Authenticating in the TUI

1. Select an HTTP/SSE server and press **C** to connect.
2. If authorization is required, the TUI starts OAuth automatically (browser opens for sign-in).
3. After the callback completes, connect finishes without a second **C**.
4. Use the **Auth** tab to inspect OAuth state (same fields as web Connection Info) or **Clear OAuth state** (disconnects when connected). Clearing also revokes the grant at the authorization server when it advertises an RFC 7009 `revocation_endpoint` — best-effort, with any failure reported in the status line and the local clear finishing regardless. Set `oauth.revokeOnClear: false` on the server entry to skip it ([#2144](https://github.com/modelcontextprotocol/inspector/issues/2144)).

See also [EMA / enterprise-managed auth](../../specification/v2_auth_ema.md) and [OAuth smoke testing](../../specification/v2_auth_smoke_testing.md) for staging servers and verification steps.

## Features

The TUI provides terminal-native tabs and panes for interacting with your MCP server:

- **Resources**: Browse and read resources exposed by the server.
- **Prompts**: List and test prompts.
- **Tools**: View available tools and execute them with form-like inputs. A tool whose advertised schema carries a portability problem is flagged in the list — red `!` for a construct a shipping MCP client refuses, yellow `?` for one handled unevenly — and the detail pane lists each finding under **Schema Portability** with the path, the problem, and a concrete fix. The verdict comes from [`core/json/schemaLint.ts`](../../core/json/schemaLint.ts), shared with the web Tools tab and the CLI's `--strict` report, so the three cannot disagree ([#1005](https://github.com/modelcontextprotocol/inspector/issues/1005)).
- **Skills**: Shown only when the connected server declares the SEP-2640 Skills extension (`io.modelcontextprotocol/skills`), since it is a *server* declaration and so only knowable after connecting. The list marks each skill with its structural verdict — `✓` conforms, `!` warnings only, `✗` an error — using a glyph as well as a colour, because this pane is read over ssh, in tmux and through `script(1)`. The detail pane shows the entry's URI, description, conformance findings and manifest. **Enter** verifies the selected skill: one `resources/read` per manifest file, each hashed against its advertised digest, plus the frontmatter cross-check that compares the served `SKILL.md`'s own frontmatter against the one the listing advertised. Verification is a gesture rather than a page load because SEP-2640 says hosts MUST NOT retrieve a skill's files ahead of need. The checks are the same ones the web Skills tab and the CLI's `--verify` run ([#2234](https://github.com/modelcontextprotocol/inspector/issues/2234), [#2248](https://github.com/modelcontextprotocol/inspector/issues/2248)).
- **Protocol**: View JSON-RPC request/response/notification history (matches the web Protocol monitor).
- **Network**: View HTTP fetch traffic for SSE / Streamable HTTP servers (matches the web Network monitor).
- **Console**: View stdio stderr from the connected server process (matches the web Console monitor).

## Navigation

- Use the **Arrow Keys** (Left/Right) or **Tab** to switch between the main tabs (Resources, Tools, Prompts, Skills, etc.).
- Use the **Arrow Keys** (Up/Down) to scroll through lists of items.
- Press **Enter** to select an item, execute a tool, or fetch a resource.
- Press **Escape** or `Ctrl+C` to exit the application.

## Development

Like the other clients, the TUI self-validates from its own folder:

```bash
npm run check          # format:check && lint && typecheck && build  (no tests)
npm run validate       # check && test
npm test               # run all tests
npm run test:coverage  # run tests under the per-file coverage gate
```

The repo-root `validate:tui` just delegates here; the root `local:validate`
(the first stage of `npm run local:gate`) runs `check` instead, so the gate
runs the suite once, under `coverage:tui` (#2341). `eslint.config.js` registers
`react-hooks` for the classic rules only (rules-of-hooks + exhaustive-deps); the
stricter react-hooks@7 rules are not enforced on the interim component surface
(#1501).

Tests live in `__tests__/`. The coverage gate covers **all of `src/**`**, React
surface included — the Ink components mount through
`__tests__/helpers/renderTui.tsx`, `ink-testing-library`'s `render` wrapped so
every frame it hands back is ANSI-stripped (with the `ink-scroll-view` /
`ink-form` passthrough doubles in the same directory),
`App.tsx` mounts against a mock of the `@inspector/core` surface, and keypresses
are driven through stdin. The former interim exclusion of the components and
`App.tsx` was lifted in #1501; the only exclusion left in `vitest.config.ts` is
`src/tui-servers.ts`, a pure re-export of core's server resolver with no runtime
statements of its own (its logic is measured in `core/` via the web suite, and
`tui-servers.test.ts` still exercises it behaviorally — it is excluded only so it
doesn't surface as a misleading 0/0 row).

**Import `render` from `__tests__/helpers/renderTui.tsx`, never from
`ink-testing-library` directly.** Ink writes styling as escape sequences *inside*
the styled run, so an accelerator underline splits the word it decorates —
`<Text underline>I</Text>nfo` reaches the frame buffer with escapes between `I`
and `nfo`, and `expect(frame).toContain("Info")` fails against a component that
is rendering correctly. Because chalk only emits color when it detects a TTY,
this is invisible in CI and hits exactly the developer whose shell exports
`FORCE_COLOR` (#2207). The wrapper strips styling from `lastFrame()` and
`frames`; the untouched bytes stay available as `stdout.lastFrame()`.

### Bundling: React-rendering dependencies must be inlined (#1952)

`tsup.config.ts` splits the TUI's dependencies into bundled (`noExternal`) and
externalized (`external`). For anything that **renders React components**, that
choice decides which React instance it gets at runtime, and getting it wrong
crashes the TUI in a way nothing in this repo can see.

An external package's `import "react"` resolves from wherever npm placed **that
package** — and npm places it beside a React satisfying *its* peer range, which
is looser than ours in every case here:

| Package | Its `react` peer | Placed beside a different React when… |
| --- | --- | --- |
| `ink-form`, `ink-scroll-view` | `">=18"` | the consumer has React 18 |
| `ink` | `">=19"` | the consumer pins React 19.0 (our `^19.2.4` then nests) |

Either way the bundle renders through one React while the external package calls
hooks on another, whose dispatcher is null — so opening a tool test form (or any
scroll view, or in `ink`'s case simply starting the TUI) dies with
`TypeError: Cannot read properties of null (reading 'useState')`.

`ink-form` and `ink-scroll-view` are therefore **inlined**, which removes npm
from the decision: an inlined package's `import "react"` is emitted into
`build/index.js`, so it resolves from the build directory exactly like the
bundle's own. Inlining also pins transitive deps to what *this* install
resolved, notably `ink-select-input@6` via the `overrides` entry — npm ignores a
dependency's `overrides`, so a consumer install would otherwise pull the
React-18-era v5 that `ink-form` asks for.

#### Why `ink` itself is the exception

`ink` is external for **cost**, not because its `">=19"` peer makes it safe — it
does not, and an earlier revision of this section wrongly claimed it did.
Bundling `ink` works (it was built and verified against both consumer repros)
but adds ~1.4 MB, since `react-reconciler` and `yoga-layout` come with it, plus
a `createRequire` banner: inlined CJS calls `require` at runtime
(`react-reconciler` for `"react"`, `signal-exit@3` for `"assert"`) and esbuild's
interop shim throws `Dynamic require of "x" is not supported` without a real
`require` in scope. A 602 KB bundle beat a 2 MB one.

What makes the exemption tolerable is a **separate lever**: the root manifest
declares `react: "^19.0.0"` — open to the whole major, rather than pinned at the
version we happen to develop against. That lets npm satisfy our React and a
consumer's pinned React 19.x with a single copy, so an external `ink` resolves
*ours*. Verified against a consumer pinning `react@19.0.0` alongside `ink@6.8.0`
— the case that splits under a narrower range:

```
bundle react   node_modules/react/index.js
ink -> react   node_modules/react/index.js   # same copy
```

Narrow that range and the exemption turns straight back into #1952, one level
up — breaking TUI startup rather than just its forms. `tsupConfig.test.ts` pins
the root range to `ink`'s own peer floor so it can't drift silently. The
residual after all this is a React **20**-era consumer that also depends on
`ink`; that gets revisited when the Inspector moves to React 20.

`__tests__/tsupConfig.test.ts` enforces the whole split: every dependency
declaring a `react` peer must be in `noExternal` unless it is listed as external
by design, each exempt package must also be a root dependency (external means
consumers install it), and the root `react` range must stay open to the major.
Add a React-rendering dependency, and that test tells you to bundle it.

### The `ink-form` label patch

Bundling `ink-form` also makes it patchable, which one label needs: the hint
under an incomplete form reads "you have not **competed** yet". It is upstream's
string, hardcoded in `ink-form/lib/SubmitButton.js` with no prop to override,
and `ink-form` was last published in 2024 — so `tsup.config.ts` corrects it with
an esbuild `onLoad` hook as the file enters the bundle. It is reported upstream
as [lukasbach/ink-form#14](https://github.com/lukasbach/ink-form/issues/14); if
a release ever carries the fix, drop the patch.

The hook **throws** when the string isn't found rather than passing the source
through. A silent no-op would let an `ink-form` upgrade retire the patch without
anyone noticing it had stopped applying — or leave a patch aimed at a string
that no longer exists. If the build fails there, check whether upstream fixed
the typo and delete the patch instead of re-targeting it.
