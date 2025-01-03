#!/usr/bin/env node

import cors from "cors";
import EventSource from "eventsource";
import { parseArgs } from "node:util";
import { parse as shellParseArgs } from "shell-quote";

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import mcpProxy from "./mcpProxy.js";
import { findActualExecutable } from "spawn-rx";

// Polyfill EventSource for an SSE client in Node.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).EventSource = EventSource;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    env: { type: "string", default: "" },
    args: { type: "string", default: "" },
    envVars: {
      type: "string",
      multiple: true,
      default: [],
      short: "e"
    },
  },
});

// Parse environment variables from command line and set them in process.env
const envFromArgs = values.envVars.reduce((acc: Record<string, string>, curr: string) => {
  const [key, value] = curr.split('=');
  if (key && value) {
    acc[key] = value;
    // Set in process.env so the main process has access
    process.env[key] = value;
  }
  return acc;
}, {});

const app = express();
app.use(cors());

let webAppTransports: SSEServerTransport[] = [];

/**
 * Creates a transport based on query parameters and command line arguments.
 * Environment variables can be provided in three ways:
 * 1. Through process.env (base environment)
 * 2. Through command line using --envVars KEY=VALUE (multiple allowed)
 * 3. Through query parameters (takes precedence)
 */
const createTransport = async (query: express.Request["query"]): Promise<Transport> => {
  console.log("Query parameters:", query);

  const transportType = query.transportType as string;

  if (transportType === "stdio") {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    // Merge environment variables from query params and command line
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};
    const mergedEnv = {
      ...process.env, // Include current process env
      ...envFromArgs, // Add our command line env vars
      ...queryEnv, // Query params take precedence
    };

    const { cmd, args } = findActualExecutable(command, origArgs);

    console.log(
      `Stdio transport: command=${cmd}, args=${args}, env=${JSON.stringify(mergedEnv)}`,
    );

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      env: mergedEnv,
      stderr: "pipe",
    });

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
  try {
    console.log("New SSE connection");

    const backingServerTransport = await createTransport(req.query);

    console.log("Connected MCP client to backing server transport");

    const webAppTransport = new SSEServerTransport("/message", res);
    console.log("Created web app transport");

    webAppTransports.push(webAppTransport);
    console.log("Created web app transport");

    await webAppTransport.start();

    if (backingServerTransport instanceof StdioClientTransport) {
      backingServerTransport.stderr!.on("data", (chunk) => {
        webAppTransport.send({
          jsonrpc: "2.0",
          method: "notifications/stderr",
          params: {
            content: chunk.toString(),
          },
        });
      });
    }

    mcpProxy({
      transportToClient: webAppTransport,
      transportToServer: backingServerTransport,
      onerror: (error) => {
        console.error(error);
      },
    });

    console.log("Set up MCP proxy");
  } catch (error) {
    console.error("Error in /sse route:", error);
    res.status(500).json(error);
  }
});

app.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    console.log(`Received message for sessionId ${sessionId}`);

    const transport = webAppTransports.find((t) => t.sessionId === sessionId);
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error in /message route:", error);
    res.status(500).json(error);
  }
});

app.get("/config", (req, res) => {
  try {
    const defaultEnvironment = getDefaultEnvironment();

    res.json({
      defaultEnvironment,
      defaultCommand: values.env,
      defaultArgs: values.args,
    });
  } catch (error) {
    console.error("Error in /config route:", error);
    res.status(500).json(error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {});
