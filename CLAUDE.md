# MCP Inspector Development Guide

## Exploring the Inspector yourself

- The MCP Inspector is a React app in the client/ directory
- The React app might be running at http://localhost:6274, if so you can use a browser tool to explore the UI
- Most React app functionality requires a connected MCP Server to test
  - If not already filled, first fill in the form values to configure the MCP Server to run
  - Use the `Connect` button in the UI to connect to the MCP Server
- Explore the running Inspector UI to learn the DOM structure and develop Playwright e2e tests

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
