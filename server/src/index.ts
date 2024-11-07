import cors from "cors";
import EventSource from "eventsource";

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import mcpProxy from "./mcpProxy.js";

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
    const args = (query.args as string).split(/\s+/);
    const env = query.env ? JSON.parse(query.env as string) : undefined;
    console.log(
      `Stdio transport: command=${command}, args=${args}, env=${JSON.stringify(env)}`,
    );
    const transport = new StdioClientTransport({ command, args, env });
    await transport.start();
    console.log("Spawned stdio transport");
    return transport;
  } else if (transportType === "sse") {
    const url = query.url as string;
    console.log(`SSE transport: url=${url}`);
    const transport = new SSEClientTransport(new URL(url));
    await transport.start();
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

  const webAppTransport = new SSEServerTransport("/message", res);
  console.log("Created web app transport");

  webAppTransports.push(webAppTransport);
  console.log("Created web app transport");

  await webAppTransport.start();

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

app.get("/default-environment", (req, res) => {
  res.json(getDefaultEnvironment());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
