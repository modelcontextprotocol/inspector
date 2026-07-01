# Inspector V2

This is an application for inspecting MCP servers. Has three incarnations, Web, TUI, and CLI.

## Project Structure

```
inspector/
├── clients/
│   ├── web/                            # Web client (Vite + React + Mantine)
│   │   ├── src/                        # Browser source (React app, hooks, components)
│   │   ├── server/                     # Node-only dev/prod backend wiring:
│   │   │                               #   vite-hono-plugin.ts (Hono middleware on the Vite dev server),
│   │   │                               #   server.ts (standalone Hono prod server),
│   │   │                               #   start-vite-dev-server.ts (in-process Vite starter for the launcher),
│   │   │                               #   web-server-config.ts (env parsing + initial-config payload + banner),
│   │   │                               #   sandbox-controller.ts (MCP Apps sandbox HTTP server),
│   │   │                               #   inject-auth-token.ts (embeds the API token into served index.html),
│   │   │                               #   vite-base-config.ts (shared optimizeDeps exclusions)
│   │   └── static/                     # sandbox_proxy.html (served by sandbox-controller for MCP Apps tab)
│   ├── cli/                            # CLI client (tsup bundle, @inspector/core alias)
│   ├── tui/                            # TUI client (Ink + React, tsup bundle)
│   ├── launcher/                       # Shared launcher (relative imports into sibling build/ outputs)
├── core/                               # Shared core code (no package.json — consumed via the `@inspector/core` vite alias)
│   ├── auth/                           # OAuth: state machine, providers, discovery, storage
│   │   ├── browser/                    # Browser-side OAuth (sessionStorage, BrowserNavigation)
│   │   ├── node/                       # Node-side OAuth (NodeOAuthStorage, OAuthCallbackServer)
│   │   └── remote/                     # Remote OAuth storage (delegates to the remote server)
│   ├── json/                           # JSON utilities and parameter/argument conversion
│   ├── logging/                        # Silent pino logger singleton
│   ├── mcp/                            # InspectorClient runtime + state stores
│   │   ├── import/                     # Config import strategies (#1348): client-config parsers
│   │   │                               #   (Claude Desktop/Cursor/Cline/VS Code), registry
│   │   │                               #   server.json parser, strategy registry + well-known
│   │   │                               #   paths, strategy-agnostic merge. Pure/isomorphic;
│   │   │                               #   used by the web file-upload path + /api/import-source.
│   │   ├── node/                       # Node stdio transport factory
│   │   ├── remote/                     # Browser HTTP/SSE transport + remote logger/fetch
│   │   │   └── node/                   # Hono-based remote server backend (used by remote/ above)
│   │   └── state/                      # Zustand-style state stores consumed by core/react/
│   ├── react/                          # React hooks over the state stores
│   └── storage/                        # File and remote storage adapters (Zustand middleware)
├── test-servers/                       # Composable MCP test servers + fixtures used by integration tests.
│   ├── src/                            # TypeScript sources.
│   ├── build/                          # Built JS (gitignored). Produced by `npm run test-servers:build`
│   │                                   # so integration tests can spawn the stdio server as a real
│   │                                   # subprocess via `node test-servers/build/test-server-stdio.js`.
│   └── tsconfig.json                   # tsc build config (NodeNext, outDir ./build).
│                                       # The Vite alias `@modelcontextprotocol/inspector-test-server`
│                                       # in clients/web/vite.config.ts points at build/index.js
│                                       # (not src/) so `getTestMcpServerPath()` returns a `.js` path.
│                                       # tsconfig.test.json keeps paths pointing at src for typecheck.
├── specification/                      # Build specification
...
```

## Development setup

v2 is **not** an npm workspace — each client under `clients/*` keeps its own `package.json` and `node_modules` (see the rationale in [specification/v2_cli_tui_launcher.md](specification/v2_cli_tui_launcher.md)). A single `npm install` at the repo root is still all you need: the root `postinstall` (`scripts/install-clients.mjs`) cascades `npm install` into `clients/web`, `clients/cli`, `clients/tui`, and `clients/launcher`.

- **Fresh clone / first-time setup:** run `npm install` at the repo root.
- **After a pull that changes a client's dependencies:** re-run `npm install` at the root to re-sync every client (the `postinstall` cascade handles it).
- The cascade is dev-only: it exits early when the package is installed under `node_modules`, and the published tarball ships only each client's `build/`, so end users are unaffected. Set `INSPECTOR_SKIP_CLIENT_INSTALL=1` to skip it.

After installing, `npm run build` builds all clients. The launcher scripts (`npm run web` / `web:dev`) run the built launcher, so build first; for day-to-day web iteration use `cd clients/web && npm run dev`.

## Repository & Project Board

- **Repo**: https://github.com/modelcontextprotocol/inspector.git
- **Base Branches**: v2/main (active), main (v1). v1.5/main is merged into v2/main and no longer takes new work.
- **Project Boards**: 
  - v2 - https://github.com/orgs/modelcontextprotocol/projects/28 (active board — all current work goes here)
  - v1 - https://github.com/orgs/modelcontextprotocol/projects/11 (existing inspector version, no new activity except security and bug fixes)

## Project Status and Direction
* The main branch currently contains the legacy version of the Inspector, which we are accepting bug fixes and minor improvement PRs for.

* The v1.5/main branch was the intermediate version of the Inspector, where the shared logic between the three incarnations of the Inspector was extracted into a core subsystem with InspectorClient class as the common entry point. It also included the TUI, a refactored CLI, and streamlined launcher. The branch still exists but is **frozen** — it takes no new work. It is kept as a reference point (e.g. for tracking down a regression introduced by the merge into v2/main), so do not delete it.

* The v2/main branch currently contains the new version of the web Inspector, composed of "dumb" components which accept data and callbacks as props and contain only display logic.

The Launcher, TUI, CLI, and InspectorClient from v1.5/main have been merged into v2/main. InspectorClient is wired up to the new web Inspector. Eventually, we will replace main with v2/main, eliminating the legacy implementations.

## Web backend auth token

The dev/prod web backend protects every `/api/*` route with `x-mcp-remote-auth: Bearer <MCP_INSPECTOR_API_TOKEN>`. The browser recovers that token from three sources, in priority order (see `App.tsx` `getAuthToken()`):

1. `window.__INSPECTOR_API_TOKEN__` — injected into `index.html` on every page load by the backend (the dev Vite plugin via `transformIndexHtml`, the prod Hono server on the `/` route), both routed through `clients/web/server/inject-auth-token.ts`. This is what makes a bare-URL reload, a bookmark, or a cleared `sessionStorage` keep working.
2. `?MCP_INSPECTOR_API_TOKEN=…` query string — the URL the launcher banner prints; kept as a fallback for pasted full URLs.
3. `sessionStorage` — backstop for navigations that land without either of the above.

Injection is a no-op when auth is disabled (`DANGEROUSLY_OMIT_AUTH`), and the global name is the shared `INSPECTOR_API_TOKEN_GLOBAL` constant in `core/mcp/remote/constants.ts`.

## Maintenance Rules

### Keep documentation files up to date
- When adding, removing, renaming, or changing the purpose of any file or folder, update the corresponding entry in the main README.md and/or the related clients/*/README.md
- When the structure of the project, the tech stack, or the developer setup changes, update appropriate README.md files with the details.
- When adding new commands, dependencies, or architectural patterns, update the relevant sections of appropriate README.md files as well.
- When rules for implementation and testing change, update this file AGENTS.md

### Issue-driven Work Style

All work should be driven by items on the project board.

> **A v2 issue is not "created" until it is BOTH labeled `v2` AND on board #28 with a Status set.** Labeling alone is not enough — a label is a repo tag; the board is a separate org project. Applying `--label v2` does **not** add the item to the board, and adding it to the board does **not** set a Status. All three are distinct steps; do all three (see the recipes below). **Only issues go on the board — never PRs.** A PR still gets the `v2` label, but it is tracked through its linked issue's card (via `Closes #N`), not its own board item.

- Before starting work, check the board for the relevant item.
- **Every board item is a real GitHub issue.** Do not create draft items (board cards with no issue number). If you find work that needs tracking, create an actual issue and add that to the board. Before creating a new issue, check the board for a matching item to avoid duplicates — **never create a duplicate**.
- **Assign the issue to its creator.** When you create an issue, assign it to the user it is created on behalf of (`gh issue create --assignee @me ...`, or `--assignee <login>`). Board items should never be unassigned.
- **Label by version.** New issues and PRs must carry the label matching the target board / branch:
  - `main` → `v1`
  - `v2/main` → `v2`

  Set the label at create time (`gh issue create --label v2 ...`, `gh pr create --label v2 ...`) — don't rely on backfilling later, since unlabeled PRs are easy to miss when filtering by version.
- **Add the issue to the board and set Status.** After creating an issue, add it to board #28 and set its Status. (PRs are never added to the board — they're tracked through their linked issue's card.) This is the step most easily forgotten because it needs several IDs — copy the recipes below verbatim.
- When work begins, create a feature branch and set the item's Status to **In progress** (or one of the building statuses below).
- When work is complete:
  - Run format, lint, typecheck, build, and test — ensure all checks pass
  - Open a PR against the matching base branch (`main` for v1, `v2/main` for v2) and set the item's Status to **In review**
  - **Link the PR to its issue.** The PR body's **first line must be `Closes #<ISSUE_NUMBER>`**. ⚠️ Note: closing keywords only auto-link/auto-close for PRs targeting the repo's **default branch** (`main`). Because v2 PRs target `v2/main` (a non-default branch), `Closes #N` there is only a cross-reference — it will **not** create a hard link or close the issue on merge. (There is no `gh` flag for manual linking — `gh pr edit` has no `--add-issue`; closing keywords are the only mechanism GitHub exposes, and they're gated to the default branch.)
  - **On merge of a v2 PR, manually close its issue and move the board item to Done** (option id `1bbc5632`), since auto-close won't fire on `v2/main`. Keep the `Closes #N` line anyway so the issues close automatically if/when `v2/main` is eventually merged to `main`.
- If new tasks are discovered or requested during development, create issues and add them to the board.

#### V2 board (#28) `gh` recipes

The board is an **org project**, so all commands use `--owner modelcontextprotocol` and the numeric project `28`. The IDs below are stable; if a command rejects one, re-fetch with `gh project field-list 28 --owner modelcontextprotocol --format json`.

| Thing | ID |
| --- | --- |
| Project node ID | `PVT_kwDOCt2Azc4BJVxt` |
| Status field ID | `PVTSSF_lADOCt2Azc4BJVxtzg5iI8c` |

Status option IDs (`--single-select-option-id`):

| Status | Option ID |
| --- | --- |
| Backlog | `6080ca99` |
| Building CLI / TUI / CORE | `fe170c62` |
| Building Web | `4faeae7a` |
| MCP Apps Extension | `588c6a63` |
| In progress | `d43284fe` |
| In review | `fb2103f2` |
| Done | `1bbc5632` |

Use **In progress** for general work, one of the **Building** statuses (or **MCP Apps Extension**) while actively coding that surface, **In review** once a PR is open, and **Done** on merge.

```sh
# 1. Add an issue to the board — prints the item id (PVTI_…); capture it.
gh project item-add 28 --owner modelcontextprotocol --url <issue-url> --format json

# 2. Set its Status (here: In progress). Use the option id from the table above.
gh project item-edit \
  --project-id PVT_kwDOCt2Azc4BJVxt \
  --id <item-id-from-step-1> \
  --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c \
  --single-select-option-id d43284fe
```

The one-liner that does both, capturing the item id (use the option id for the status you want):

```sh
ITEM_ID=$(gh project item-add 28 --owner modelcontextprotocol --url <issue-url> --format json --jq '.id')
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id d43284fe
```

### Always test new or modified code
- Ensure all code has corresponding tests
- Ensure test coverage for each file is at least 90%
- In unit tests that expect error output, suppress it from the console
- Run unit tests with `npm run test` (or `npm run test:watch` during development) from `clients/web/`
- Run CLI tests with `npm run test` from `clients/cli/` (builds test-servers + CLI bin first via `pretest`)
- Run TUI tests with `npm run test` from `clients/tui/`
- The repo root has no aggregate `test` script — each client self-validates, so run `npm run validate` from the root (all clients, fast) or `cd clients/<name> && npm run validate` (one client). Each client still exposes its own `test` / `test:coverage` for quick iteration.
- **`validate` is fast: it runs `test`, not `test:coverage`.** The coverage gate (slower — adds v8 instrumentation, and for web the integration project) is a **separate** top-level `npm run coverage` (and per-client `coverage:web` / `coverage:cli` / `coverage:tui` / `coverage:launcher`, each delegating to that client's `test:coverage`). Run `npm run coverage` when you want the gate. **CI does NOT run `coverage`** — the gate is local-only; CI runs `validate` (fast) plus the web integration suite (`clients/web` `test:integration`, no coverage) so the integration paths are still exercised.
- Each client's `test:coverage` enforces a **uniform per-file gate of ≥ 90 on all four dimensions** — lines, statements, functions, and branches — across `clients/web`, `clients/cli`, `clients/tui`, and `clients/launcher` (CI enforces this gate). This is the result of a codebase-wide audit: the branch floor was first lifted 50 → 70 for web (#1271), then the whole gate raised to 90 with real tests added for every outlier. Genuinely-unreachable branches are **not** waved through by lowering the gate — they are annotated at the source with a justified `/* v8 ignore … -- <reason> */` comment. Acceptable reasons are happy-dom-inherent paths (Mantine portal mount points, `useMediaQuery` fallbacks, `typeof window` SSR guards), React StrictMode effect-replay blocks, and provably-dead defensive guards (e.g. a `?? fallback` for a value the types guarantee non-null, or a `Select.onChange` receiving a value outside the allowed list). New code must clear 90 on every dimension; reach for a justified `v8 ignore` only when a branch is genuinely impossible to exercise.
- The **same per-file gate** is enforced for the CLI and TUI (#1484), not just web:
  - **CLI** (`clients/cli`): tests run **in-process** by importing `runCli()` (see `__tests__/helpers/cli-runner.ts`) so `clients/cli/src` is measured under v8 instrumentation. A thin out-of-process layer (`__tests__/e2e.test.ts` + `scripts/smoke-cli.mjs`) still spawns the built binary for the shebang/`process.exit` paths; `src/index.ts` (binary bootstrap) is the only coverage exclusion. `commander` uses `.exitOverride()` so a parse error throws instead of tearing down the test worker.
  - **TUI** (`clients/tui`): the gate covers the **non-React logic** only — `logger.ts`, `components/tabsConfig.ts`, and `utils/*` (server resolution lives in `core/` and is measured by the web suite). The Ink components, `App.tsx`, and `hooks/` are an **interim exclusion** in `clients/tui/vitest.config.ts` pending the renderer-based follow-up (#1501). When adding new **non-React** logic under `clients/tui/src`, it falls under the gate automatically — add tests for it.
- Run `npm run test:integration` (also from `clients/web/`) for the InspectorClient + transport + auth integration suite. It runs under a separate `integration` vitest project in node env (no happy-dom) with 30s timeouts. The script builds `test-servers/` first via `tsc -p ../../test-servers --noCheck` so the stdio MCP test server can be spawned as a real subprocess. CI runs it as its own step after unit tests.
- Test files live alongside the source as `<Name>.test.tsx` (or `.test.ts` for non-React modules). Integration tests live under `clients/web/src/test/integration/`, mirroring the `core/` source layout (`mcp/`, `mcp/node/`, `mcp/remote/`, `auth/`, `auth/node/`, `storage/`). Any test file under that folder is automatically picked up by the `integration` vitest project (node env, 30s timeouts) via the folder glob in `vite.config.ts` — placement is the manifest, there is no enumeration to keep in sync. Tests outside the folder run in the `unit` project (happy-dom). When adding a new test for, e.g., `core/mcp/remote/foo.ts`, put it at `src/test/integration/mcp/remote/foo.test.ts`.
- Use `renderWithMantine` from `src/test/renderWithMantine.tsx` to render components — it wraps in `MantineProvider` with the project theme

### Responding to Code Reviews
- When asked to respond to a code review of a PR,
  - it is not necessary to implement all suggestions
  - you are free to implement suggestions in a different way or to ignore if there is a good reason
  - after making the changes, respond to each review comment with what was done (or why it was ignored)

### Lint-fixed, Formatted code
- ALWAYS do `npm run format` before committing — it auto-fixes any Prettier issues. `validate` runs `format:check` (the non-fixing variant) and will fail in CI on any unformatted file, so always run the auto-fixer first rather than letting `format:check` catch it.
- ALWAYS do `npm run validate` before pushing any changes — from the repo root it chains the four per-client validations (`validate:web` → `validate:cli` → `validate:tui` → `validate:launcher`); each delegates to that client's own `npm run validate` = `format:check` + `lint` + `build` + `test` in its own folder (no coverage — fast). Every client is self-validating and the top level just chains them, building each client's bundle along the way (no cross-client build dependencies).
  - The one CLI nuance: `clients/cli`'s out-of-process `e2e.test.ts` spawns the built binary, so its `test` **builds first** via `pretest` (`test-servers:build && build`). To avoid building it twice, `clients/cli`'s `validate` folds that in — it is `format:check && lint && test` with **no** separate `build` step (the other clients, whose tests don't spawn their bundle, keep an explicit `build`). `validate:web`/`validate:tui`/`validate:launcher` are the uniform `format:check && lint && build && test`.
  - Before pushing, also run **`npm run coverage`** — `validate` is fast and does NOT enforce the per-file gate (or, for web, run the integration project); `coverage` does both. CI does **not** run `coverage` (the gate is local-only); it runs `validate` plus a standalone web `test:integration` step.
- **`smoke` is a separate top-level target, NOT part of `validate`.** Run it (or the individual `smoke:*`) after a build/validate: `npm run validate && npm run smoke`. It runs `smoke:launcher` (`--help` dispatch) plus the prod `smoke:cli` / `smoke:tui` / `smoke:web`, and contains **no build commands** — it assumes the cli/tui/launcher bundles already exist (a full `validate` builds them; `smoke:web` builds `clients/web/dist` on demand). CI runs `validate`, then the web `test:integration` step, then `smoke`. Storybook is the only CI step left out (see below).
- `smoke:launcher` (`scripts/smoke-launcher.mjs`) runs the built launcher with `--help`, `--cli --help`, and `--tui --help`, asserting each exits 0 and prints that mode's usage banner (which also proves the launcher resolved and loaded the right client build). It's the cheap dispatch check before the heavier prod smokes below.
- `smoke:web` (`scripts/smoke-web.mjs`) starts `mcp-inspector --web` (prod, no `--dev`) against the built `clients/web/dist` and asserts `GET /` serves the SPA (HTTP 200) with the injected `__INSPECTOR_API_TOKEN__`. Prod `--web` serves from `clients/web/dist`, which ships in the published package but is absent in a fresh checkout — the runner builds it on demand (`build:client` = `vite build`) on first launch, or exits with an actionable error if that build can't run (see `clients/web/server/ensure-web-build.ts` and the launcher README). `--dev` runs Vite directly and never needs `dist`.
- `smoke:cli` (`scripts/smoke-cli.mjs`) drives `mcp-inspector --cli` through the built launcher against the bundled stdio test server via a temp `--catalog`: it asserts `tools/list` returns the server's tools (real connect over stdio), the default writable catalog is seeded empty on first run, a missing read-only `--config` errors without seeding, and `--catalog` + `--config` is rejected. `smoke:tui` (`scripts/smoke-tui.mjs`) launches `mcp-inspector --tui --catalog <temp>` and asserts the Ink app renders its first frame (the "MCP Servers" panel) within a timeout, then SIGTERMs it — a shallow boot/render check, not full interaction. **`smoke:tui` is local-only: it self-skips when `process.env.CI` is set**, because the Ink TUI needs a real TTY (raw mode) that headless CI lacks — so run it (via `npm run smoke`) on your own machine before pushing. Both build `test-servers/build` on demand if it's missing.
- Also run `npm run test:storybook` from `clients/web/` before pushing — it executes every story's `play` function in headless Chromium via `@vitest/browser-playwright` (~10s). CI runs this as a separate step (from `clients/web`) after `validate`; failures block merge. It is kept out of `validate` because it needs the Playwright browser binary and is much slower than the unit suite. (There is no root-level `test:storybook` aggregate — run it in the web client.)

### Typescript instructions
- Use TypeScript for all new code
- Follow TypeScript best practices and coding standards
- NEVER use 'any' as a type
- NEVER suppress error types (e.g., no-unused-vars, no-explicit-any) in the typescript or eslint configuration as a way of satisfying the linter or compiler.
- Utilize type annotations and interfaces to improve code clarity and maintainability
- Leverage TypeScript's type inference and static analysis features for better code quality and refactoring
- Use type guards and type assertions to handle potential type mismatches and ensure type safety
- Take advantage of TypeScript's advanced features like generics, type aliases, and conditional types to write more expressive and reusable code
- Regularly review and refactor TypeScript code to ensure it remains well-structured and adheres to evolving best practices

## React instructions
- UI Components
  - We are using the Mantine component library for UI.
  - Instructions are at https://mantine.dev/llms.txt
  - Avoid using div and other basic HTML elements for layout purposes.
  - Prefer Mantine's Box, Group, and Stack components for layout.
  - Use Mantine's theme and styling utilities to ensure a consistent and responsive design.
  - NEVER use inline styles on a component.
  - NEVER use raw hex values (`#ddd`, `#94a3b8`, etc.) or `rgba()` literals for colors in component props or theme files. Use `--inspector-*` CSS custom properties defined in `App.css :root` (e.g., `c: 'var(--inspector-text-primary)'`). If no existing token fits, add one to `:root` first.
  - NEVER add a CSS class to a Mantine component when the styles can instead be expressed as component props or a theme variant. CSS classes are a last resort.
  - PREFER component props (via `.withProps()`) to CSS for behavioral and visual styles.
  - PREFER defining styles as theme variants (via `Component.extend()` in `src/theme/<Component>.ts`) over CSS classes. Each Mantine component with custom variants has its own file in `src/theme/`, exporting a `Theme<Name>` constant. The barrel `src/theme/index.ts` re-exports them all and `theme.ts` imports from the barrel. Flat CSS properties (margin, padding, background, border, color, font-size, etc.) belong in the theme. Only pseudo-selectors, nested child selectors, keyframes, and native HTML element styles belong in App.css.
  - App.css must contain ONLY styles that cannot be expressed in the Mantine theme: `@keyframes`, pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships, nested child-element selectors for third-party HTML output (e.g. ReactMarkdown), and styles for native HTML elements (`img`, `iframe`). When refactoring a component, actively move any flat CSS properties out of App.css and into theme variants or `.withProps()` constants.
  - NEVER use inline code; instead extract to functions in the same file, exported or located in a shared location if immediately reusable.
  - In a component's file, for sub-components:
    - ALWAYS use Mantine components for layout and content, configured with props for styling and behavior.
    - ALWAYS declare a meaningfully named subcomponent as a constant using `.withProps()` if a component has two or more props.
    - NEVER use `Box` for subcomponent constants — `Box` does not support `.withProps()`. Use `Group`, `Stack`, `Flex`, `Text`, `Paper`, `UnstyledButton`, or `Image` instead. Pick the component that best matches the purpose: `Paper` for bordered/surfaced containers, `Text` for any text or content wrapper, `Stack`/`Group`/`Flex` for layout.
    - NEVER use a CSS class on a subcomponent constant when the styles can be expressed as a Mantine theme variant instead. Define variants in `src/theme/<Component>.ts` using `Component.extend({ styles: (_theme, props) => { ... } })` and reference them with `variant="variantName"` on the component or in `.withProps()`.
    - CSS classes are ONLY acceptable on subcomponents for styles that cannot be expressed as flat CSS-in-JS properties in the theme — specifically: pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships (`.parent:hover .child`), nested child-element selectors (`.wrapper p`, `.wrapper code`), `@keyframes` definitions, and native HTML elements (`img`, `iframe`) that are not Mantine components.
    - When a theme variant needs a CSS class for nested/pseudo selectors, use `classNames` in the theme extension to auto-assign it — never add `className` manually in JSX for theme-styled components.
    - Example — subcomponent constant with `withProps`:
    ```tsx
      const CardContent = Group.withProps({
        flex: 1,
        align: 'flex-start',
        justify: 'space-between',
        wrap: 'nowrap',
      });
      return <CardContent> ... </CardContent>
    ```
    - Example — theme variant with auto-assigned className for nested selectors:
    ```tsx
      // src/theme/Paper.ts
      export const ThemePaper = Paper.extend({
        classNames: (_theme, props) => {
          if (props.variant === 'message') return { root: 'message' };
          return {};
        },
        styles: (_theme, props) => {
          if (props.variant === 'message') {
            return { root: { padding: '1.5rem', borderRadius: 12 } };
          }
          return { root: {} };
        },
      }),

      // Component.tsx
      const MessageContainer = Paper.withProps({ variant: 'message' });
    ```
- Theme files vs. Storybook element components
  - **Theme files** (`src/theme/<Component>.ts`) and **element components** (`src/components/elements/`) serve different purposes and both are needed.
  - Theme files customize every instance of a Mantine component app-wide — defaults (size, radius), custom variants, and global style overrides. They are applied automatically by `MantineProvider`.
  - Element components add domain-specific semantics on top of Mantine primitives. For example, `AnnotationBadge` maps domain concepts (audience, destructive, longRun) to Mantine's styling primitives (color, variant). Storybook documents these domain components for designers and developers.
  - Element components MUST import from `@mantine/core`, NOT from `src/theme/`. The theme layer is applied transparently by the provider — elements do not need to know about `Theme<Name>` constants.
  - NEVER push domain-specific variant logic (e.g., annotation types, transport types) into theme files. Domain variants belong in the element component that owns those semantics. Theme files are for styling that applies to the Mantine primitive globally.
