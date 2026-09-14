# Architecture

## The `@inspector/core` shared package

![Shared code architecture: the four clients over the @inspector/core shared package](../specification/diagrams/shared-code-architecture.png)

`core/` holds the logic shared by all three clients so that web, CLI, and TUI behave identically. Its entry point is the **`InspectorClient`** class (`core/mcp/`), which owns the connection to an MCP server, the request/response lifecycle, and a set of state stores; `core/react/` exposes React hooks over those stores that both the web and TUI (Ink) React trees consume — each reading its snapshot **during render** via `useSyncExternalStore`, so a store swap lands in the same frame and no event dispatched between render and subscribe is lost ([#1955](https://github.com/modelcontextprotocol/inspector/issues/1955)). OAuth (`core/auth/`) is factored into isomorphic logic plus browser/node/remote backends so the same flows work in the browser, in Node, and against a remote backend.

`core/` intentionally has **no `package.json`** — it is not published on its own. Each client bundles it in via a `@inspector/core` alias:

- **CLI / TUI:** `esbuildOptions.alias` in their `tsup.config.ts` maps `@inspector/core` → the repo `core/` directory, and `noExternal: [/^@inspector\/core/]` inlines it into the bundle.
- **Web:** two configs, because the client is two builds — `clients/web/vite.config.ts` for the browser app, and `clients/web/tsup.runner.config.ts` for the Node backend runner, which defines the alias itself.

Publishing `core/` as its own package (e.g. for third parties to build on) is deliberately deferred — see issue [#1636](https://github.com/modelcontextprotocol/inspector/issues/1636).

## Web client: "dumb components" + Storybook

The v2 web client is built from **presentational ("dumb") components** — they accept data and callbacks as props and contain only display logic, with no direct data fetching or client state. State comes from the `@inspector/core` hooks, wired in near the top of the tree. This keeps components isolated, testable, and documentable.

That approach is what makes **Storybook** first-class here: every screen and element component has a `*.stories.tsx` file (96+ stories) that renders it against fixture props. Storybook **play functions** double as interaction tests, run headless in GitHub CI (`test:storybook`, Chromium via Playwright) and in the local gate (`npm run local:storybook`, which installs the browser first).

Styling follows a strict Mantine-first convention (theme variants and component props over CSS classes, `--inspector-*` CSS custom properties over raw color literals). The full rules live in [`AGENTS.md`](../AGENTS.md) under **React instructions** — read them before touching web UI. Element components live in `clients/web/src/components/elements/`; theme variants in `clients/web/src/theme/`.

