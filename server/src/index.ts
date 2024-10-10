import cors from "cors";

import { Server } from "mcp-typescript/server/index.js";
import { SSEServerTransport } from "mcp-typescript/server/sse.js";
import express from "express";
import { Client } from "mcp-typescript/client/index.js";
import { StdioClientTransport } from "mcp-typescript/client/stdio.js";
import mcpProxy from "./mcpProxy.js";

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

  await webAppTransport.connectSSE(req, res);
  await server.connect(webAppTransport);

  mcpProxy({
    transportToClient: webAppTransport,
    transportToServer: backingServerTransport,
    onerror: (error) => {
      console.error(error);
      server.close();
    },
  });
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
