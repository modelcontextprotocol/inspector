# MCP Inspector

The MCP inspector is a developer tool for testing and debugging MCP servers.

## Getting started

This repository depends on the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/). Until these repositories are made public and published to npm, the SDK has to be preinstalled manually:

1. Download the [latest release of the SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases) (the file named something like `modelcontextprotocol-sdk-0.1.0.tgz`). You don't need to extract it.
2. From within your checkout of _this_ repository, run `npm install --save path/to/sdk.tgz`. This will overwrite the expected location for the SDK to allow you to proceed.

Then, you should be able to install the rest of the dependencies normally:

```sh
npm install
```

You can run it in dev mode via:

```bash
npm run dev
```

This will start both the client and server.

To run in production mode:

```bash
npm run build
npm start
```
