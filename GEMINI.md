# Gemini Project Context: MCP Inspector

## Project Overview

The **MCP Inspector** is a developer tool designed for testing and debugging servers implementing the **Model Context Protocol (MCP)**. It provides a visual interface and a command-line interface to interact with MCP servers, explore their capabilities (tools, resources, prompts), and monitor protocol traffic.

### Architecture

The project is a TypeScript monorepo using NPM workspaces:

- **`client/`**: A React-based web UI (built with Vite, Tailwind CSS, and Radix UI) that provides an interactive dashboard.
- **`server/`**: An Express-based proxy server that bridges the web UI (running in a browser) to various MCP transport methods (STDIO, SSE, Streamable HTTP).
- **`cli/`**: A unified command-line interface that allows running the inspector in both UI and CLI-only modes.
- **`scripts/`**: Utility scripts for version management and consistency checks.

### Main Technologies

- **Languages**: TypeScript (Strict mode)
- **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, Lucide Icons, Shadcn UI (components/ui)
- **Backend**: Node.js, Express 5, `@modelcontextprotocol/sdk`
- **CLI**: Commander.js
- **Testing**: Vitest (CLI), Jest (Client unit tests), Playwright (E2E)
- **Formatting/Linting**: Prettier, ESLint

---

## Building and Running

### Development

```bash
npm install        # Install all dependencies
npm run dev        # Start client and server in dev mode (default port 6274)
```

### Production Build

```bash
npm run build      # Build all workspaces (client, server, cli)
npm start          # Run the built application
```

### Testing

```bash
npm test           # Run prettier check and client unit tests
npm run test-cli   # Run CLI-specific tests (Vitest)
npm run test:e2e   # Run Playwright E2E tests
```

---

## Development Conventions

### Code Style & Structure

- **Naming**:
  - `PascalCase` for React components and Types/Interfaces.
  - `camelCase` for variables and functions.
  - `kebab-case` for file and directory names.
- **Components**: Functional components using React Hooks. Complex logic should be extracted into custom hooks (see `client/src/lib/hooks/`).
- **Styling**: Tailwind CSS for layout and styling. Prefer Radix UI primitives for accessible UI components.
- **Modules**: Strict use of ES Modules (`import/export`). `type: "module"` is set in `package.json`.

### MCP Protocol Handling

- The **Proxy Server** (`server/src/index.ts`) is critical for handling transport translation.
- **Security**: The proxy uses a session token (`MCP_PROXY_AUTH_TOKEN`) for authentication by default. DNS rebinding protection is implemented via origin validation.
- **Transports**: Supports `stdio`, `sse`, and `streamable-http`. Note that `sse` is often deprecated in favor of `streamable-http`.

### Testing Practices

- **Unit Tests**: Use Jest for React components (`client/__tests__`) and Vitest for CLI logic (`cli/__tests__`).
- **E2E Tests**: Use Playwright for browser-based automation tests in `client/e2e/`.
- **Pre-commit**: Husky is used to run `prettier --write` on staged files.

---

## Technical Learnings & Patterns

### UI & Resizing Logic

- **State vs. CSS Synchronization**: When using JS state to control element dimensions (e.g., `width`), always clamp the state values (`minSize`, `maxSize`) to match the CSS constraints. Failure to do so creates a "dead zone" where the UI feels stuck because the JS state continues to grow while CSS visually blocks it.
- **Resizer Usability**: To ensure resizers are grabable even when a panel is collapsed to 0px, remove `overflow-hidden` from the resizable container and use an absolute-positioned hit area (e.g., `left-[-8px]`).
- **Unified Resizing**: Prefer a generic `useResizable` hook that returns raw `size` values, allowing individual components to map them to `width` or `height` as needed.

### Browser Hacks

- **Autocomplete History**: Standard React forms often fail to trigger browser autocomplete history. A "Hidden Iframe Hack" (targeting an invisible `<iframe>` on form submission) can trick the browser into recording input history without requiring a page reload.

### Proxy Stability

- **Connection Resilience**: MCP Proxy `send` operations should always be wrapped in `.catch()` blocks. Standard stderr/stdout events from MCP servers can trigger after a browser client has disconnected, leading to unhandled promise rejections ("Not connected") that crash the proxy server.
- **Session Cleanup**: Always explicitly delete sessionId references from `webAppTransports`, `serverTransports`, and `sessionHeaderHolders` during any disconnection event to prevent memory leaks and "ghost" sessions.

### CLI Enhancements

- **Dev Mode Flexibility**: The `client/bin/start.js` script was updated to forward MCP server commands and arguments even in `--dev` mode, allowing developers to test local servers without full production builds.

---

## Milestones

- **2026-02-03**: Created [Pull Request #1050](https://github.com/modelcontextprotocol/inspector/pull/1050) targeting UI responsiveness and proxy stability. Includes resizable panels, browser history for tools, and proxy connection resilience.

## Key Files

- `package.json`: Root workspace configuration.
- `client/src/App.tsx`: Main React entry point and layout.
- `server/src/index.ts`: Proxy server entry point and transport routing logic.
- `cli/src/cli.ts`: CLI entry point for the unified inspector binary.
- `AGENTS.md`: High-level development guide for the project.
- `CLAUDE.md`: Quick reference for development commands.
