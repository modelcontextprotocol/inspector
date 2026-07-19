# Inspector CLI v2 (session-oriented design)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [CLI, TUI, Launcher (as-built)](v2_cli_tui_launcher.md) | CLI v2 design | [Catalog / launch config](v2_catalog_launch_config.md)

Living design doc for the **session-oriented Inspector CLI** (connect once, many subcommands). Tracked by [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432). Sourced from that issue; **iterate here** — the issue remains the board card / umbrella.

The following describes the **planned next-generation Inspector command-line client**: what exists today, what we want to build, why, and how. CLI v2 is new work in **`clients/cli`** on shared **`core/`** (`@inspector/core`).

Our goal is for the Inspector v2 CLI to fully support all aspects and modalities of MCP (as supported by the TUI and Web Inspectors), including complex operations and multiple operations per server connection. In addition, the Inspector v2 CLI will expose all aspects of MCP in a way that can be leveraged by production hosts to access those MCP aspects and modalities even when the host does not directly support them via its MCP implementation (with the host using the Inspector CLI via its CLI mechanism).

This approach was inspired by [mcpc](https://github.com/apify/mcpc) from Apify.

**Related docs:** [CLI, TUI, and Launcher](v2_cli_tui_launcher.md) (as-built one-shot CLI), [Catalog and Launch Configuration](v2_catalog_launch_config.md), [Storage](v2_storage.md), [Auth](v2_auth.md), [`clients/cli/README.md`](../clients/cli/README.md).

---

## 1. Introduction

The Inspector CLI today is a **one-shot** client: each command connects to an MCP server, performs **one** operation, prints JSON, and exits. CLI v2 adds a **session-oriented** model—**connect once**, run **many** commands against a **named session**, then **disconnect**—on the same **`InspectorClient`** stack the web and TUI already use.

### 1.1 How the Inspector CLI works today

The launcher selects CLI mode with `--cli`. Every invocation is self-contained:

1. Parse **which server** to use (`--config` + `--server`, or a URL, plus transport/headers/env—see [v2_catalog_launch_config.md](v2_catalog_launch_config.md)).
2. Require **`--method`** naming a single MCP operation.
3. **`connect()`** → perform that operation → print **`JSON.stringify(result)`** to stdout → **`disconnect()`** → exit.

There is no persistent session and no subcommands—only “pick method + args.”

**Example: list tools, then call one**

Each line below is a **separate process** with its own spawn, handshake, and teardown:

```bash
# List tools (connect → tools/list → disconnect)
inspector --cli \
  --config mcp.json --server myserver \
  --method tools/list

# Call a tool (connect → tools/call → disconnect)
inspector --cli \
  --config mcp.json --server myserver \
  --method tools/call \
  --tool-name search \
  --tool-arg query=hello
```

That works well for **scripts and CI** that need one JSON blob per run. It is awkward when you want to **explore a server**, run **several related steps**, or use MCP features that span **multiple RPCs over one connection** (tasks, subscriptions, OAuth that you do not want to repeat every time).

Supported `--method` values and flags are listed in §3.2; see [clients/cli/README.md](../clients/cli/README.md) for more examples.

### 1.2 CLI v2 session workflow

CLI v2 supports a **session-oriented** workflow alongside v1 one-shots:

1. **Connect** to a server and register a **named session** (conventionally `@name`).
2. Run **many subcommands** against that session without reconnecting.
3. **Disconnect** when finished.

Unlike v1, connection setup happens **once per session**; subsequent commands reuse that MCP connection. A background **session daemon** (§5.3) holds each **`InspectorClient`**; it starts **automatically**—users run `connect` and session commands only, with no separate “start daemon” step.

**Example: connect, run commands, disconnect** (illustrative command names; see §5.4)

```bash
mcp connect --config mcp.json --server myserver @myserver
mcp @myserver tools list
mcp @myserver tools call search query=hello
mcp @myserver tasks get task-abc123
mcp @myserver disconnect
```

v1 **`--method`** one-shots remain for backward compatibility **and** work alongside session mode—see §2, §5, and §6.

### 1.3 Why session-oriented CLI matters

**Exercise a server across multiple operations.** Real workflows are rarely a single RPC: list tools, inspect a schema, call a tool, read a resource, adjust log level, then call again. Session mode matches how people use `kubectl`, `docker`, or database CLIs—a stable **context** and many commands—instead of repeating server selection and handshake on every line of a script or manual debugging session.

**Exercise advanced MCP client behavior.** Some protocol features only make sense **across calls on one connection**:

- **Tasks** — launch a long-running operation (often via a task-augmented tool call), poll **`tasks/get`**, fetch **`tasks/result`**, or **`tasks/cancel`** while the server keeps state.
- **Subscriptions** — **`resources/subscribe`**, then observe **`notifications/resources/updated`** over time.
- **Logging** — set level once, then **`logging tail`** (follow **`notifications/message`**) during later tool calls.
- **OAuth** — authenticate once per session instead of on every ephemeral invocation.

**Example: long-running task over one session** (illustrative CLI v2 ergonomics; exact command names TBD):

```bash
mcp connect --config mcp.json --server batch @batch
mcp @batch tools call start_export format=json    # may return a task id
mcp @batch tasks get export-task-42               # poll status
mcp @batch tasks result export-task-42            # fetch result when done
mcp @batch disconnect
```

That sequence is impossible to express cleanly with v1’s one-shot **`--method`** model—you would need a custom script that reconnects and somehow preserves server-side task identity across separate processes.

The web and TUI Inspector clients already do this interactively. CLI v1 exposes only a narrow one-shot subset; CLI v2 closes the **ergonomics** gap, not a gap in core protocol support (§7).

**Access full MCP via CLI when the host lacks native support.** Agent hosts often implement only part of the MCP **client** protocol—commonly tools, sometimes resources or prompts, rarely tasks, subscriptions, roots, completions, or sampling/elicitation. The **server** may still expose the full feature set. Inspector CLI v2’s job is to let an agent reach **any** of those server capabilities through **documented CLI commands**, using a shell tool the host already provides, instead of requiring the host to add native MCP client support for every feature and modality.

The model does not need a **`tasks/get`** (or **`prompts/get`**, **`resources/subscribe`**, …) RPC on its primary MCP connection. It runs Inspector CLI; the CLI uses **`InspectorClient`** to speak MCP to the server and returns JSON the model can parse. Native MCP where the host supports it; CLI bridge where it does not—same server, full protocol surface available to the agent.

**Example: tasks via CLI when the host has tools MCP only**

The agent’s MCP connection supports **`tools/*`** but not tasks. The user asks for a long export. The model uses the CLI session to call the tool, poll task status, and fetch the result:

```bash
mcp connect --config mcp.json --server jobs @jobs
mcp @jobs tools call start_export format=json
mcp @jobs tasks get export-task-42
mcp @jobs tasks result export-task-42
```

The same pattern applies to any modality the host omits: **`prompts get`**, **`resources subscribe`**, **`logging tail`**, and so on—whatever **`InspectorClient`** supports and the server advertises, exposed as CLI subcommands rather than native MCP in the agent runtime.

---

## 2. Summary

CLI v2 evolves **`clients/cli` in place**: session-oriented subcommands on **`InspectorClient`**, with v1 **`--method`** one-shots preserved (§6).

|                       | **Today (CLI v1)**                                                                 | **Target (CLI v2)**                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package**           | `clients/cli` → `@modelcontextprotocol/inspector-cli`                              | Same package and launcher; add **`mcp`** command (§5.2)                                                                                              |
| **Process model**     | Connect → **one** MCP operation → disconnect **per invocation**                    | **Session:** connect once, many commands on a named `@session` (implicit daemon, §5.3); **ephemeral:** v1 one-shots unchanged                          |
| **Protocol coverage** | tools, resources, prompts, `logging/setLevel` (one-shot only)                     | Full client surface aligned with **TUI / web** (`InspectorClient` + state managers)—tools, resources, prompts, tasks, logging, roots, subscriptions, OAuth, completions, etc. (phased) |
| **Use cases**         | Scripts, CI, agents needing a single JSON result per run                           | Multi-step server exercise; advanced MCP over one connection (tasks, subscriptions, …); agents reach **any server capability via CLI** when the host lacks native MCP support for that feature |
| **Output**            | JSON to stdout                                                                     | JSON by default; human-readable mode where useful                                                                                                   |
| **Implementation**    | Commander wrapper over **`InspectorClient`**                                       | Same package; **`clients/cli/src/daemon/`** for session daemon + IPC (§7.2); subcommands, v1 compat layer |

---

## 3. What we have today (CLI v1)

§1.1 covers the user-facing behavior; this section is the implementation reference.

### 3.1 Code location and shape

| Piece                         | Location                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| Entry / argument parsing      | `clients/cli/src/cli.ts`                                                  |
| Launcher forwarding           | `clients/launcher/src/index.ts` (`--cli` → CLI workspace)                 |
| MCP client                    | `@inspector/core` → **`InspectorClient`**            |
| Transport + config resolution | `core/mcp/node/config.ts` (`resolveServerConfigs`), `createTransportNode` |
| Tests                         | `clients/cli/__tests__/` (Vitest, stdio + HTTP against test servers)      |

Each invocation:

1. Parses **which server** to use (shared flags: `--config`, `--server`, positional command/URL, `--transport`, headers, env—see [v2_catalog_launch_config.md](v2_catalog_launch_config.md)).
2. Requires **`--method`** naming an MCP-style operation.
3. Constructs **`InspectorClient`**, **`connect()`**, performs **exactly one** operation, prints **`JSON.stringify(result)`**, **`disconnect()`**, exits.

There is **no** persistent session, **no** subcommands beyond “pick method + args”, and **no** interactive shell.

### 3.2 Supported operations (v1)

`--method` must be one of (see error text in `cli.ts`):

| `--method`                 | Purpose                 | Extra flags                                                  |
| -------------------------- | ----------------------- | ------------------------------------------------------------ |
| `tools/list`               | List tools              | `--metadata`                                                 |
| `tools/call`               | Call a tool by name     | `--tool-name`, `--tool-arg`, `--tool-metadata`, `--metadata` |
| `resources/list`           | List resources          | `--metadata`                                                 |
| `resources/read`           | Read a resource         | `--uri`, `--metadata`                                        |
| `resources/templates/list` | List resource templates | `--metadata`                                                 |
| `prompts/list`             | List prompts            | `--metadata`                                                 |
| `prompts/get`              | Get a prompt            | `--prompt-name`, `--prompt-args`, `--metadata`               |
| `logging/setLevel`         | Set server log level    | `--log-level`                                                |

Anything else throws **Unsupported method**.

Internally, list operations use core **state managers** (`ManagedToolsState`, etc.) for a single refresh; **`tools/call`** resolves the tool **by name** from that list, then calls **`InspectorClient.callTool(tool, …)`**—the same pattern TUI uses when invoking a tool from the managed list.

### 3.3 What v1 does **not** cover (but core already does)

`InspectorClient` and the TUI/web clients already support (or are adding) capabilities **not** exposed on the CLI today, for example:

- **Tasks** (list/get/cancel, task-augmented tool calls, streaming progress)
- **Sampling / elicitation** (client-as-requestor flows)
- **Resource subscriptions** and **list-changed** notifications
- **Roots** (`getRoots`, `setRoots` on the client; answers server `roots/list` requests)
- **Completions** (prompt/resource argument completion)
- **OAuth** flows and token management as first-class UX
- **Pagination** (`listTools` / `listResources` with cursors)
- **Structured tool results**, metadata on prompts/resources beyond what v1 passes through

CLI v1 is intentionally minimal. The gap is **CLI surface area and session ergonomics** (§1.3), not missing protocol support in core.

---

## 4. Goals and principles

1. **One CLI product** — Evolve v1 inside **`clients/cli`** (same npm package and launcher entry).
2. **Core-first** — All MCP I/O through **`InspectorClient`** and the same **state managers** TUI/web use (`ManagedToolsState`, `MessageLogState`, etc.). CLI v2 **composes** existing APIs (list → resolve entity → call/read/get); it does not depend on new core helpers. Do not bypass core with a raw SDK `Client` in the CLI layer.
3. **Two lifecycles, one implementation**
   - **Ephemeral:** connect → one operation (or fixed sequence) → disconnect — **backward compatible** with today’s `inspector --cli … --method …`.
   - **Session:** named session, many commands; **implicit session daemon** (§5.3) holds the connection—no user-managed start step.
4. **Parity trajectory** — CLI v2 should be able to expose the same MCP **client** capabilities as TUI/web over time (phased commands, not a big-bang).
5. **Shared configuration and auth** — Same **`mcp.json`** / CLI flags as today ([v2_catalog_launch_config.md](v2_catalog_launch_config.md)); same **`OAuthManager`** and Node credential storage as other Node clients ([v2_storage.md](v2_storage.md) / [v2_auth.md](v2_auth.md)).
6. **Automation-safe** — JSON output, stable exit codes; in **scripts and CI**, require an explicit `@session` (or `--session @name`)—do not rely on default-session resolution unless opted in via env (§5.6).
7. **No interactive shell** — Each command is a separate **`mcp …`** invocation (session commands talk to the implicit daemon over IPC). No REPL, no **`shell`** subcommand—now or later. Interactive exploration remains the job of **TUI / web**; automation and agents use subprocess + JSON.

---

## 5. Target architecture

V2 examples in this section use **`mcp`** (§5.2). **`inspector --cli`** and **`mcp-inspector --cli`** remain supported for backward compatibility (§6).

### 5.1 High-level picture

```
                    ┌─────────────────────────────────────┐
                    │  mcp  (primary CLI command, §5.2)   │
                    │  inspector --cli  (launcher, compat)│
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼──────────-─────────┐
                    │  CLI v2 (Commander / subcommands)    │
                    │  • session admin (connect, list, …)  │
                    │  • MCP commands (tools, resources, …)│
                    │  • compat layer (--method …)         │
                    └─────────┬───────────────┬──────-─────┘
                              │               │
              ephemeral       │               │  session mode
              (in-process)    │               │
                              ▼               ▼
                    ┌───────────---───┐   ┌───────────────-───┐
                    │ InspectorClient │   │ Session daemon    │
                    │ connect → op    │   │ (one Client each) │
                    │ → disconnect    │   │ ◄── IPC ──► CLI   │
                    └───────────---───┘   └─────────┬─────────┘
                              │                     │
                              └────-──-───┬─────────┘
                                          ▼
                           @inspector/core
                             (transport, OAuth, state managers)
```

### 5.2 The `mcp` command

Today the CLI is reached through the **launcher**: `inspector --cli …` (installed binary **`mcp-inspector`**, plus **`mcp-inspector-cli`** from the CLI workspace). CLI v2 adds **`mcp`** as the primary command—it runs the **same CLI entrypoint** the launcher forwards to, without the `--cli` flag.

| Command | What runs |
| ------- | --------- |
| **`mcp …`** | **`clients/cli`** directly—primary v2 UX |
| `inspector --cli …` | Launcher → `clients/cli` (unchanged) |
| `mcp-inspector --cli …` | Same as above (unchanged) |

**Implementation** — no change to how we publish **`@modelcontextprotocol/inspector`**. Add a **`bin`** entry on the root package (and matching entry on **`@modelcontextprotocol/inspector-cli`**) pointing at **`clients/cli/build/index.js`**, alongside existing bins. Update Commander’s program name to **`mcp`** for help text.

### 5.3 Session daemon (implicit)

Session mode uses a **session daemon**—a long-lived Node process that owns live MCP connections. **Users do not start or manage it in normal use.** The first session-mode need (typically **`connect`**, or a command against an existing session) **auto-spawns** the daemon in the background if it is not already running; later **`mcp`** invocations attach over IPC (Unix domain socket or platform equivalent).

**Daemon responsibilities**

- Own **one `InspectorClient` per named session**
- Accept **IPC** from short-lived CLI front-end processes
- Forward **list/call/read/…** to the right client and return JSON (or structured errors)
- Handle **notifications** (logging, list-changed) and optionally broadcast them to attached clients

**Lifecycle**

- **`mcp connect`** may bootstrap **daemon + session in one step**—no prior daemon required.
- **Single instance** per user/machine (socket + lock file); stale socket after crash is detected and recovered on next command.
- **Shutdown:** daemon exits when all sessions are **`disconnect`**ed and an **idle timeout** elapses (duration TBD), or when the last open session closes—whichever policy we implement.
- **Ephemeral mode** (v1 **`--method`** one-shots) **never** uses the daemon; **`InspectorClient`** runs in-process and exits.

**When users need visibility** (optional, not required for everyday use)

- **`mcp daemon status`** — is the daemon running, active sessions, socket path
- **`mcp daemon stop`** — tear down daemon and all sessions (troubleshooting)
- **`mcp daemon run`** (optional) — run daemon in foreground for debugging

The daemon uses **`InspectorClient`** with the same OAuth and transport setup as TUI. Secrets are **not** passed on **`argv`** when spawning sessions over IPC (see §5.7).

### 5.4 Command surface (planned categories)

Exact names are TBD; illustrative grouping:

| Category      | Examples                                                                              | Core backing                                            |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Session**   | `connect`, `disconnect`, `sessions list`, `session use`; optional `daemon status` / `daemon stop` | Implicit daemon (§5.3) + session store                |
| **Tools**     | `tools list`, `tools call`, `tools call --task`                                       | **`ManagedToolsState`**, `callTool`, `callToolStream`   |
| **Resources** | `resources list`, `resources read`, `resources templates list`, `resources subscribe` | `listResources`, `readResource`, subscriptions          |
| **Prompts**   | `prompts list`, `prompts get`, `prompts complete`                                     | `listPrompts`, `getPrompt`, `getCompletions`            |
| **Logging**   | `logging set-level`, `logging tail` (follow notifications)                            | `setLoggingLevel`, **`MessageLogState`**                |
| **Tasks**     | `tasks list`, `tasks get`, `tasks cancel`, `tasks result`                             | **`ManagedRequestorTasksState`**, `callToolStream`, …   |
| **Auth**      | `auth login`, `auth logout`, `auth status`                                            | **`OAuthManager`** (via `connect`), Node storage        |
| **Roots**     | `roots list`, `roots set`                                                             | **`getRoots`**, **`setRoots`**                          |
| **Compat**    | Hidden or documented: `--method tools/list` …                                         | Maps to same handlers as subcommands                    |

Global flags (all modes): `--json`, `--config`, `--server`, verbosity, `--session @name` (or positional `@name`).

### 5.5 Config and server selection

**Unchanged from v1:** resolution via `resolveServerConfigs` and shared flags documented in [v2_catalog_launch_config.md](v2_catalog_launch_config.md).

**Session records** store at minimum:

- Session **name** (user-chosen, `@`-prefixed in UX)
- **Server identity** (config path + server id, or normalized ad-hoc target)
- **Connection state** (in daemon)
- **Last accessed** timestamp — updated whenever the user (or agent) runs a command against that session; drives default session for `@`-less commands (§5.6)

### 5.6 Default session (`@`-less commands)

When a session-mode command omits `@name` (e.g. `mcp tools list` instead of `mcp @myserver tools list`), the CLI targets the **most recently accessed session**—the session last used by any session-scoped command, including **`connect`**, an explicit **`@name …`**, or **`sessions use @name`**.

- **Update last-accessed** on every command that successfully targets a named session (including `connect`, which creates or reopens that session).
- **No sessions** → clear error telling the user to `connect` first.
- **Automation / CI** → default session is **disabled** unless explicitly opted in (non-TTY, or `MCP_SESSION=@name` set, or `--session @name` passed). Pipelines must not accidentally hit the wrong server because an interactive user connected to something else earlier on the same machine.
- **Explicit `@name` always wins** when provided; default session is a convenience for interactive use and agent sessions where the model has been working in one context.

```bash
mcp connect --config mcp.json --server a @alpha
mcp connect --config mcp.json --server b @beta
mcp @alpha tools list          # last accessed → @alpha
mcp tools list                 # same (still @alpha)
mcp @beta resources list       # last accessed → @beta
mcp tools call search q=hello  # uses @beta
```

### 5.7 OAuth and secrets

CLI v2 must use the same paths as other Node clients:

- **`OAuthManager`** inside **`InspectorClient.connect()`** — no CLI-only OAuth stack
- **Node `OAuthStorage`** in core (same store as TUI; see [v2_storage.md](v2_storage.md) / [v2_auth.md](v2_auth.md))

Daemon startup must **not** put secrets on **`argv`** (stdio `env`/`args`, HTTP headers): pass full server config over IPC after the socket is listening, before `connect()`.

---

## 6. Backward compatibility (CLI v1)

### 6.1 Requirement

Existing scripts and docs that use:

```bash
inspector --cli … --method tools/list
```

must **keep working** through a **compatibility entrypoint** (same flags, same JSON shape on stdout, same exit behavior on error). **`mcp … --method …`** is equivalent (§5.2).

### 6.2 Implementation approach

- **Ephemeral handler** shared with v2 subcommands: parse v1 argv → build `MCPServerConfig` → `InspectorClient` → dispatch by `--method` → print JSON.
- v1 **`--method`** table (§3.2) remains supported; new methods may be added under `--method` **or** only under subcommands (document per method).
- Deprecation: if we later prefer subcommands in docs, v1 flags stay until a **major** Inspector release with a published migration guide.

### 6.3 Mapping (v1 → v2 ergonomics)

| CLI v1                                                          | CLI v2 (illustrative)                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `inspector --cli … --method tools/list`                         | `mcp tools list` (ephemeral) **or** `mcp @s tools list` (session) |
| `inspector --cli … --method tools/call --tool-name X --tool-arg k=v` | `mcp tools call X k=v`                                    |
| `… --config mcp.json --server myserver --method resources/list` | `mcp connect myserver` then `mcp @myserver resources list`    |

Session mode is **opt-in**; v1 one-liners remain valid without `connect`.

---

## 7. Building on core (same stack as TUI / web)

CLI v2 does **not** require new MCP capabilities in **`@inspector/core`** / `core/`. Web and TUI already cover the full client feature set through **`InspectorClient`** and optional **state managers** (`core/mcp/state/` + [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md)). CLI v2 adds **subcommands**, **session lifecycle**, **output formatting**, and optionally a **session daemon**—composition work in **`clients/cli`**, not protocol gaps in core.

### 7.1 Patterns to reuse (not reimplement)

| CLI need | How v1 / TUI / web do it today |
| -------- | ------------------------------ |
| **Call tool by name** | **`ManagedToolsState`** (or `listTools`) → find by `name` → **`callTool(tool, args, …)`**. v1 already does this in `clients/cli/src/cli.ts`; TUI passes the selected **`Tool`** from the managed list. Scripts pass a name; the CLI resolves it from the cached list—the same pattern as picking a tool in the UI. |
| **List tools / resources / prompts** | **`Managed*State`** for full lists (auto-refresh on `*ListChanged`), or **`Paged*State`** / cursor loops on **`listTools(cursor)`** etc. v1 uses managed states for a one-shot refresh per invocation. |
| **Logging tail** | **`MessageLogState`** subscribes to protocol **`message`** events (includes server logging via **`notifications/message`**). Stream or filter entries for `logging tail`. |
| **Tasks** | **`ManagedRequestorTasksState`** / **`PagedRequestorTasksState`**; streaming tool calls via **`callToolStream`**. |
| **Roots** | **`getRoots()`** / **`setRoots()`** on **`InspectorClient`**. |
| **Subscriptions, completions, OAuth** | Direct **`InspectorClient`** methods and events; Node credential storage per [v2_storage.md](v2_storage.md) / [v2_auth.md](v2_auth.md)—same as TUI. |

### 7.2 Where CLI v2 work actually lives

All implementation belongs in **`clients/cli`**—one **`npm`** package (**`@modelcontextprotocol/inspector-cli`**), same publish story as today. No separate **`cli-daemon`** workspace.

**Layout**

| Area | Location |
| ---- | -------- |
| CLI front-end (Commander, subcommands, v1 compat) | `clients/cli/src/` (existing + new command modules) |
| Session daemon (IPC server, session registry, auto-spawn) | **`clients/cli/src/daemon/`** |
| Shared command handlers | Callable from both ephemeral CLI and daemon IPC paths |

The daemon subdirectory owns long-lived process management; the CLI front-end stays short-lived subprocess invocations talking to it over IPC (§5.3). **`mcp`** and the daemon share types and handlers in-process within the same package—no cross-workspace imports.

**Responsibilities**

- Subcommand tree and argv parsing (Commander)
- Ephemeral vs session-daemon process model and IPC
- JSON / human-readable output and exit codes
- v1 **`--method`** compatibility routing to shared handlers
- Per-session wiring of **`InspectorClient`**, **`createTransportNode`**, **`resolveServerConfigs`**, and the state managers above

If a workflow feels awkward, check how TUI/web solve it with existing core APIs before proposing core changes.

---

## 8. Phased delivery

**Note:** The one-shot CLI/TUI/launcher from v1.5 are already on `v2/main` (see [v2_cli_tui_launcher.md](v2_cli_tui_launcher.md)). Session-oriented CLI v2 builds on that baseline.

Suggested phases (adjust in planning):

| Phase                      | Deliverable                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| **0 — Design**             | This doc; command naming RFC; daemon IPC sketch                                                |
| **1 — Compat + structure** | Commander subcommand tree; v1 `--method` routed through shared handlers; **`mcp` bin** (§5.2); tests ported/extended |
| **2 — Session daemon**     | Implicit auto-spawn; `connect` / `disconnect` / `sessions list`; IPC; `@session` on subcommands |
| **3 — Breadth**            | Tools/resources/prompts/logging subcommands via managed/paged state managers; pagination, structured content |
| **4 — Advanced**           | Tasks, subscriptions, roots, completions, OAuth UX—same **`InspectorClient`** + managers as TUI |
| **5 — Polish**             | Docs, launcher help text, ergonomics polish                                                  |

Each phase should ship test coverage (Vitest + test-servers harness, same as v1).

---

## 9. Testing and documentation

- **Unit / integration:** Extend `clients/cli/__tests__/`; use `@modelcontextprotocol/inspector-test-server` composable fixtures where possible.
- **Session daemon:** Separate test suite with mock IPC or in-process daemon for CI.
- **Docs:** Update [clients/cli/README.md](../clients/cli/README.md) with v2 command reference; keep a **“Legacy `--method` interface”** section until removal.
- **Cross-links:** [v2_catalog_launch_config.md](v2_catalog_launch_config.md) unchanged except examples showing session commands.

