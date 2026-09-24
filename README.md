# MCP Inspector

A developer tool for inspecting [Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers. It ships as a single package, `@modelcontextprotocol/inspector`, that provides three ways to inspect a server:

- **Web** — a Vite + React + [Mantine](https://mantine.dev) single-page app with a Node backend.
- **CLI** — a scriptable command-line client for automation, CI, and fast agent feedback loops.
- **TUI** — an interactive terminal UI built with [Ink](https://github.com/vadimdemedes/ink).

All three run through one global `mcp-inspector` binary:

```bash
npx @modelcontextprotocol/inspector          # web UI (default)
npx @modelcontextprotocol/inspector --cli    # CLI
npx @modelcontextprotocol/inspector --tui    # TUI
```

> [!WARNING]
> **The Inspector manages secrets — OAuth tokens, OAuth client secrets, and stdio `env:` values — and stores them in the OS keychain, if available, by default.** On a machine with no keychain — Linux without libsecret or a Secret Service, headless and SSH sessions, Termux, and containers with a mounted volume — they are saved to `~/.mcp-inspector/secrets.json` instead, unencrypted unless you supply a key. See [Where secrets are stored](./docs/secret-storage.md) for how to get a keychain back, encrypt the file, or keep secrets in memory only.

> **Upgrading from v1?** Read the [v1 → v2 migration guide](./docs/v1-to-v2-migration.md) — CLI flags, the new `--config` vs. `--catalog` split, the Node engine bump, and what no longer ships.

> **Repo status.** This is the **v2** line of the Inspector. Active development happens on **`v2/main`** (the develop branch — all v2 PRs target it), which is merged into **`main`** at milestone releases; `main` is the default branch and holds the latest released v2, published to the npm `latest` tag. The legacy **v1** line lives on **`v1/main`** — security fixes only, published straight from that branch to the npm `v1-latest` tag (`npx @modelcontextprotocol/inspector@v1-latest`). See [`AGENTS.md`](./AGENTS.md) for branch/board conventions.

## Quick start (development)

Requires Node `>=22.19.0`.

```bash
npm install          # at the repo root; postinstall cascades into every client
npm run build        # web → cli → tui → launcher
```

For day-to-day **web** iteration, run Vite directly — fast HMR, no launcher build needed:

```bash
cd clients/web && npm run dev
```

The launcher-driven scripts run the **built** launcher, so build first:

```bash
npm run web        # prod web launcher against clients/web/dist
npm run web:dev    # web launcher in --dev mode (Vite)
```

v2 is **not** an npm workspace — each client under `clients/*` keeps its own `package.json` and `node_modules`, and shared code lives in `core/`, consumed via a `@inspector/core` build-time alias. **Every runtime dependency `core/` imports is declared once, in the repo-root `package.json`**, and each client declares only what that client alone consumes — its UI stack, its bundler-inlined packages, its dev tooling — which leaves `clients/cli` and `clients/launcher` with no runtime dependencies of their own. What that means for adding a dependency (root vs. client, `dependencies` vs. `devDependencies`, and the bundler `external` lists) is in the [`local-dev` skill](./.claude/skills/local-dev/SKILL.md).

## Project layout

```
inspector/
├── clients/
│   ├── web/          Web client (Vite + React + Mantine). src/ = browser app; server/ = Node backend
│   ├── cli/          CLI client (tsup bundle, @inspector/core alias)
│   ├── tui/          TUI client (Ink + React, tsup bundle)
│   └── launcher/     Shared launcher — provides the `mcp-inspector` bin, dispatches to web/cli/tui
├── core/             Shared code consumed via the `@inspector/core` alias (no package.json)
├── test-servers/     Composable MCP test servers + fixtures used by integration and smoke tests
├── scripts/          Root build/verify tooling (install cascade, smokes, the verify:* guards)
│                     and repo automation run from CI (the dependency, Dependabot-alert and SDK sweeps)
├── docs/             Task-oriented guides — see below
├── specification/    Design/build specifications
├── .claude/skills/   Agent skills: the repo's procedures, invokable by name
├── AGENTS.md         Contribution rules for agents AND humans
└── README.md         You are here
```

Each client has its own README with client-specific detail:
[web](./clients/web/README.md) · [cli](./clients/cli/README.md) · [tui](./clients/tui/README.md) · [launcher](./clients/launcher/README.md).

## Documentation

| Guide | Covers |
| --- | --- |
| [Architecture](./docs/architecture.md) | The `@inspector/core` shared package, and the web client's "dumb components" + Storybook approach |
| [Testing and the quality gate](./docs/quality-gate.md) | What each `validate` / `coverage` / `smoke` / `verify:*` script covers, the GitHub-CI-vs-local-gate split, and the supported browsers |
| [Writing a skill](./docs/skill-authoring.md) | How to write a skill description that actually fires, and eval cases that measure it — the case shapes that work, and the tuning loop |
| [Test servers](./docs/test-servers.md) | The composable test servers and the showcase config for every feature — what to run, what to click, and what the broken build did |
| [Publishing](./docs/publishing.md) | What ships in the tarball, the packaging invariants, and `pack:verify` |
| [Docker](./docs/docker.md) | Running the container image — ports, volumes, and making secrets durable in a container |
| [Where secrets are stored](./docs/secret-storage.md) | How the secret store is chosen on every runtime — OS keychain, `secrets.json` or memory — plus file encryption, locking, and moving back to a keychain |
| [Migrating from v1 to v2](./docs/v1-to-v2-migration.md) | CLI flag mapping, `--config` vs. `--catalog`, the Node engine bump, env-var renames |
| [Environment variables](./docs/environment-variables.md) | Every variable that changes runtime behavior — auth, ports, storage, the secret store, logging, proxies — plus the Node TLS variables for a self-signed server |
| [MCP server configuration](./docs/mcp-server-configuration.md) | Which server(s) the Inspector connects to, and the config file format |
| [Reviewing an MCP App](./docs/mcp-app-review.md) | The CLI-first → one-shot-web recipe for automated App-tool review |
| [Smoke-testing an MCP server](./docs/cli-smoke-testing.md) | The connect → list → call → assert workflow for a shell or CI job: `--format json` + `jq`, the exit-code map, and keeping OAuth non-interactive |
| [Launcher and config consolidation](./docs/launcher-config-consolidation-plan.md) | Why the launcher runs a client in-process rather than spawning it |
| [Roadmap, Aug 2026 → Feb 2027](./docs/inspector-roadmap-2026-h2.md) | The six-month plan: spec-following work aligned to the published MCP roadmap, official extension support, and the experience work we choose |

## Testing and the quality gate

Each client self-validates from its own folder; the root scripts chain them. There is **no** aggregate root `test` script.

```bash
npm run validate     # fast inner loop: format:check + lint + typecheck + build + unit tests
npm run coverage     # the per-file ≥90% gate (lines/statements/functions/branches)
npm run local:gate   # MANDATORY before pushing — every GitHub CI check, plus two local-only ones
```

`npm run local:gate` chains every check below, plus the smokes and the Storybook tests. [Testing and the quality gate](./docs/quality-gate.md) owns the stage list and says what each one covers and why two are local-only; [`AGENTS.md`](./AGENTS.md) holds the testing rules themselves.

## Contributing — `AGENTS.md`, `CLAUDE.md`, and the skills

**[`AGENTS.md`](./AGENTS.md) is the contract for changing this codebase, and it applies to humans and AI agents alike.** It is not agent-only boilerplate — it holds the project's real **rules**: the version/label conventions, the TypeScript and Mantine/React standards, the testing and coverage requirements, and the mandatory pre-push gate. Read it before making changes, and keep it up to date when you change structure, tooling, or rules.

The repo's **procedures** — multi-step recipes with commands and live IDs — live in [`.claude/skills/`](./.claude/skills) instead, one directory per procedure, so they are loaded only when the task calls for them. They are ordinary committed Markdown: an agent that doesn't understand skills can read them, and `AGENTS.md` carries an index of what exists. Claude Code users invoke one by name (`/release`, `/issue-triage`, …).

`CLAUDE.md` is the entry point [Claude Code](https://claude.com/claude-code) loads automatically; it includes `AGENTS.md`, so agents and humans work from the same source of truth. If you use a different agent that reads `AGENTS.md`, you get the same rules.

A key rule worth surfacing here: **all work is issue-driven.** Before starting, find or create a tracking issue on the v2 project board; open PRs against `v2/main` with `Closes #<issue>`. External contributions are accepted as **issues, not pull requests** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

See [`LICENSE`](./LICENSE). The MCP project is transitioning from the MIT License to Apache-2.0: new code contributions are licensed under Apache-2.0, documentation (excluding specifications) under CC-BY-4.0, and contributions whose authors originally licensed them under MIT and have not granted relicensing consent remain under MIT. The file carries the full Apache-2.0 and MIT texts and links the CC-BY-4.0 legal code.
