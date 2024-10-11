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

let webAppTransports: SSEServerTransport[] = [];

const createTransport = async (query: express.Request["query"]) => {
  console.log("Query parameters:", query);

  const transportType = query.transportType as string;

  if (transportType === "stdio") {
    const command = query.command as string;
    const args = (query.args as string).split(",");
    console.log(`Stdio transport: command=${command}, args=${args}`);
    const transport = new StdioClientTransport();
    await transport.spawn({ command, args });
    console.log("Spawned stdio transport");
    return transport;
  } else if (transportType === "sse") {
    const url = query.url as string;
    console.log(`SSE transport: url=${url}`);
    const transport = new SSEClientTransport();
    await transport.connect(new URL(url));
    console.log("Connected to SSE transport");
    return transport;
  } else {
    console.error(`Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");

  const backingServerTransport = await createTransport(req.query);

  console.log("Connected MCP client to backing server transport");

  const webAppTransport = new SSEServerTransport("/message");
  console.log("Created web app transport");

  webAppTransports.push(webAppTransport);
  console.log("Created web app transport");

  await webAppTransport.connectSSE(req, res);

  mcpProxy({
    transportToClient: webAppTransport,
    transportToServer: backingServerTransport,
    onerror: (error) => {
      console.error(error);
    },
  });
  console.log("Set up MCP proxy");
});

app.post("/message", async (req, res) => {
  const sessionId = req.query.sessionId;
  console.log(`Received message for sessionId ${sessionId}`);

  const transport = webAppTransports.find((t) => t.sessionId === sessionId);
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
