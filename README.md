# MCPJam Inspector

The MCPJam inspector is a dev tool for testing and debugging MCP servers. The MCPJam inspector is a fork of the [mcp-inspector](https://github.com/modelcontextprotocol/inspector) with additional improvements.

<img width="1511" alt="Screenshot 2025-05-26 at 11 18 18 PM" src="https://github.com/user-attachments/assets/ade8a46a-f738-4d32-ac85-260a5e22b90f" />

## Running the Inspector

#### Requirements

- Node.js: ^22.7.5

### Usage

It's the easiest to start up the inspector via `npx`. This will download the inspector and immediately run it on localhost.

```bash
npx @mcpjam/inspector
```

### Other ways to run inspector

You can also spin up the inspector with these shortcut params. For example, if your server is built at `build/index.js`:

```bash
npx @mcpjam/inspector node build/index.js
```

There are many other shortcuts to connect with servers. They run the same way as the original inspector. See [here](https://github.com/modelcontextprotocol/inspector) for details.

## Features

## License

This project is licensed under the MIT License—see the [LICENSE](LICENSE) file for details.
