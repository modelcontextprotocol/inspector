# MCP Inspector Development Guide

> **Note:** Inspector V2 is under development to address architectural and UX improvements. During this time, V1 contributions should focus on **bug fixes and MCP spec compliance**. See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## Build Commands

- Build all: `npm run build`
- Build web: `npm run build-web`
- Development mode: `npm run dev` (use `npm run dev:windows` on Windows)
- Format code: `npm run prettier-fix`
- Web lint: `cd clients/web && npm run lint`

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

## Tool Input Parameter Handling

When implementing or modifying tool input parameter handling in the Inspector:

- **Omit optional fields with empty values** - When processing form inputs, omit empty strings or null values for optional parameters, UNLESS the field has an explicit default value in the schema that matches the current value
- **Preserve explicit default values** - If a field schema contains an explicit default (e.g., `default: null`), and the current value matches that default, include it in the request. This is a meaningful value the tool expects
- **Always include required fields** - Preserve required field values even when empty, allowing the MCP server to validate and return appropriate error messages
- **Defer deep validation to the server** - Implement basic field presence checking in the Inspector client, but rely on the MCP server for parameter validation according to its schema

These guidelines maintain clean parameter passing and proper separation of concerns between the Inspector client and MCP servers.

## Project Organization

The project is organized as a monorepo with workspaces:

- `clients/web/`: Web application (Vite, TypeScript, Tailwind)
- `core/`: Core shared code used by web, CLI, and TUI
- `clients/cli/`: Command-line interface for testing and invoking MCP server methods directly
- `clients/tui/`: Terminal user interface
- `test-servers/`: Composable MCP test servers, fixtures, and harness
