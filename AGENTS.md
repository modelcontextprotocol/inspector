# MCP Inspector Development Guide

> **Note:** Inspector V2 is under development to address architectural and UX improvements. During this time, V1 contributions should focus on **bug fixes and MCP spec compliance**. See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## Build Commands

- Build all: `npm run build`
- Build web: `npm run build-web`
- Development mode: `npm run dev` (use `npm run dev:windows` on Windows)
- Format code: `npm run prettier-fix`
- Web lint: `cd web && npm run lint`

## Code Style Guidelines

- Use TypeScript with proper type annotations
- Follow React functional component patterns with hooks
- Use ES modules (import/export) not CommonJS
- Use Prettier for formatting (auto-formatted on commit)
- Follow existing naming conventions:
  - camelCase for variables and functions
  - PascalCase for component names and types
  - kebab-case for file names
- Use async/await for asynchronous operations
- Implement proper error handling with try/catch blocks
- Use Tailwind CSS for styling in the web app
- Keep components small and focused on a single responsibility

## Project Organization

The project is organized as a monorepo with workspaces:

- `web/`: Web application (Vite, TypeScript, Tailwind)
- `core/`: Core shared code used by web, CLI, and TUI
- `cli/`: Command-line interface for testing and invoking MCP server methods directly
- `tui/`: Terminal user interface
- `test-servers/`: Composable MCP test servers, fixtures, and harness
