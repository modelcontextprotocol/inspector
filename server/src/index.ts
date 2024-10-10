import McpClient from "./client.js";
import cors from "cors";

import { Server } from "mcp-typescript/server/index.js";
import { SSEServerTransport } from "mcp-typescript/server/sse.js";
import express from "express";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "mcp-typescript/types.js";

const app = express();
app.use(cors());

let servers: Server[] = [];

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  const command = decodeURIComponent(req.query.command as string);
  const args = decodeURIComponent(req.query.args as string).split(",");
  const mcpClient = new McpClient("MyApp", "1.0.0");
  await mcpClient.connectStdio(command, args);

  const transport = new SSEServerTransport("/message");
  const server = new Server({
    name: "mcp-server-inspector",
    version: "0.0.1",
  });
  servers.push(server);

  server.onclose = async () => {
    console.log("SSE connection closed");
    servers = servers.filter((s) => s !== server);
    await mcpClient.close();
  };

  server.setRequestHandler(ListResourcesRequestSchema, () => {
    return mcpClient.listResources();
  });

  server.setRequestHandler(ReadResourceRequestSchema, (params) => {
    return mcpClient.readResource(params.params);
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => {
    return mcpClient.listPrompts();
  });

  server.setRequestHandler(GetPromptRequestSchema, (params) => {
    return mcpClient.getPrompt(params.params);
  });

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return mcpClient.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, (params) => {
    return mcpClient.callTool(params.params);
  });
  await transport.connectSSE(req, res);
  await server.connect(transport);
});

app.post("/message", async (req, res) => {
  console.log("Received message");

  const transport = servers
    .map((s) => s.transport as SSEServerTransport)
    .find((t) => true);
  if (!transport) {
    res.status(404).send("Session not found");
    return;
  }
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
