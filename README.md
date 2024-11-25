# MCP Inspector

The MCP inspector is a developer tool for testing and debugging MCP servers.

![MCP Inspector Screenshot](mcp-inspector.png)

## Running the Inspector

### From an MCP server repository

To inspect an MCP server implementation, there's no need to clone this repo. Instead, use `npx`. For example, if your server is built at `build/index.js`:

```bash
npx @modelcontextprotocol/inspector build/index.js
```

You can also pass arguments along which will get passed as arguments to your MCP server:

```
npx @modelcontextprotocol/inspector build/index.js arg1 arg2 ...
```

The inspector runs both a client UI (default port 5173) and an MCP proxy server (default port 3000). Open the client UI in your browser to use the inspector. You can customize the ports if needed:

```bash
CLIENT_PORT=8080 SERVER_PORT=9000 npx @modelcontextprotocol/inspector build/index.js
```

### From this repository

If you're working on the inspector itself:

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## License

This project is licensed under the MIT License—see the [LICENSE](LICENSE) file for details.
