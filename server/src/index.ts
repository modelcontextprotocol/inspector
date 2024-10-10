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
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  ListToolsResultSchema,
  CallToolResultSchema,
} from "mcp-typescript/types.js";
import { Client } from "mcp-typescript/client/index.js";
import { StdioClientTransport } from "mcp-typescript/client/stdio.js";

const app = express();
app.use(cors());

let servers: Server[] = [];

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  const command = decodeURIComponent(req.query.command as string);
  const args = decodeURIComponent(req.query.args as string).split(",");
  const mcpClient = new Client({ name: "MyApp", version: "1.0.0" });
  const backingServerTransport = new StdioClientTransport();
  await backingServerTransport.spawn({ command, args });
  await mcpClient.connect(backingServerTransport);

  const webAppTransport = new SSEServerTransport("/message");
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

  server.setRequestHandler(ListResourcesRequestSchema, () =>
    mcpClient.request(
      {
        method: "resources/list",
      },
      ListResourcesResultSchema,
    ),
  );

  server.setRequestHandler(ReadResourceRequestSchema, (params) =>
    mcpClient.request(
      {
        method: "resources/read",
        params: params.params,
      },
      ReadResourceResultSchema,
    ),
  );

  server.setRequestHandler(ListPromptsRequestSchema, () =>
    mcpClient.request(
      {
        method: "prompts/list",
      },
      ListPromptsResultSchema,
    ),
  );

  server.setRequestHandler(GetPromptRequestSchema, (params) => {
    return mcpClient.request(
      {
        method: "prompts/get",
        params: params.params,
      },
      GetPromptResultSchema,
    );
  });

  server.setRequestHandler(ListToolsRequestSchema, () =>
    mcpClient.request(
      {
        method: "tools/list",
      },
      ListToolsResultSchema,
    ),
  );

  server.setRequestHandler(CallToolRequestSchema, (params) =>
    mcpClient.request(
      {
        method: "tools/call",
        params: params.params,
      },
      CallToolResultSchema,
    ),
  );

  await webAppTransport.connectSSE(req, res);
  await server.connect(webAppTransport);
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
