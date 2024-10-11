import cors from "cors";

import { SSEServerTransport } from "mcp-typescript/server/sse.js";
import express from "express";
import { StdioClientTransport } from "mcp-typescript/client/stdio.js";
import mcpProxy from "./mcpProxy.js";

const app = express();
app.use(cors());

let transports: SSEServerTransport[] = [];

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  const command = decodeURIComponent(req.query.command as string);
  const args = decodeURIComponent(req.query.args as string).split(",");
  const backingServerTransport = new StdioClientTransport();
  await backingServerTransport.spawn({ command, args });

  const webAppTransport = new SSEServerTransport("/message");
  transports.push(webAppTransport);

  await webAppTransport.connectSSE(req, res);

  mcpProxy({
    transportToClient: webAppTransport,
    transportToServer: backingServerTransport,
    onerror: (error) => {
      console.error(error);
    },
  });
});

app.post("/message", async (req, res) => {
  console.log("Received message");

  const transport = transports.find((t) => true);
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
