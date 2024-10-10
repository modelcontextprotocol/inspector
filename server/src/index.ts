import cors from "cors";
import EventSource from "eventsource";

import { SSEServerTransport } from "mcp-typescript/server/sse.js";
import express from "express";
import { StdioClientTransport } from "mcp-typescript/client/stdio.js";
import mcpProxy from "./mcpProxy.js";
import { SSEClientTransport } from "mcp-typescript/client/sse.js";

// Polyfill EventSource for an SSE client in Node.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).EventSource = EventSource;

const app = express();
app.use(cors());

let transports: SSEServerTransport[] = [];

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  const transportType = req.query.transportType as string;

  let backingServerTransport;
  console.log("Query parameters:", req.query);

  if (transportType === "stdio") {
    const command = decodeURIComponent(req.query.command as string);
    const args = decodeURIComponent(req.query.args as string).split(",");
    backingServerTransport = new StdioClientTransport();
    await backingServerTransport.spawn({ command, args });
  } else if (transportType === "sse") {
    const url = decodeURIComponent(req.query.url as string);
    backingServerTransport = new SSEClientTransport();
    await backingServerTransport.connect(new URL(url));
  } else {
    throw new Error("Invalid transport type specified");
  }

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
