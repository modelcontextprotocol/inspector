# MCP Inspector Development Guide

## Build Commands

- Build all: `npm run build`
- Build client: `npm run build-client`
- Build server: `npm run build-server`
- Development mode: `npm run dev` (use `npm run dev:windows` on Windows)
- Format code: `npm run prettier-fix`
- Client lint: `cd client && npm run lint`

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
- Use Tailwind CSS for styling in the client
- Keep components small and focused on a single responsibility

## Project Organization

The project is organized as a monorepo with workspaces:

- `client/`: React frontend with Vite, TypeScript and Tailwind
- `server/`: Express backend with TypeScript
- `cli/`: Command-line interface for testing and invoking MCP server methods directly

## Tool Input Validation Guidelines

When handling tool input parameters and form fields:

- **Optional fields with empty values should be omitted entirely** - Do not send empty strings or null values for optional parameters, UNLESS the field has an explicit default value in the schema that matches the current value
- **Fields with explicit defaults should preserve their default values** - If a field has an explicit default in its schema (e.g., `default: null`), and the current value matches that default, include it in the request. This is a meaningful value the tool expects
- **Required fields should preserve their values even when empty** - This allows the server to properly validate and return appropriate error messages
- **Deeper validation should be handled by the server** - Inspector should focus on basic field presence, while the MCP server handles parameter validation according to its schema

These guidelines ensure clean parameter passing and proper separation of concerns between the Inspector client and MCP servers.
