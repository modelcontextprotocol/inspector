#!/usr/bin/env node

import cors from "cors";
import { parseArgs } from "node:util";
import { parse as shellParseArgs } from "shell-quote";
import { createServer } from "node:net";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";
import { findActualExecutable } from "spawn-rx";
import mcpProxy from "./mcpProxy.js";
import { randomUUID } from "node:crypto";
import { logGeneral, logServer, logsDir } from './logger.js';
import { launchMCPServer } from './processLauncher.js';
import { Readable } from 'stream';

const SSE_HEADERS_PASSTHROUGH = ["authorization"];
const STREAMABLE_HTTP_HEADERS_PASSTHROUGH = [
  "authorization",
  "mcp-session-id",
  "last-event-id",
];

const defaultEnvironment = {
  ...getDefaultEnvironment(),
  ...(process.env.MCP_ENV_VARS ? JSON.parse(process.env.MCP_ENV_VARS) : {}),
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    env: { type: "string", default: "" },
    args: { type: "string", default: "" },
  },
});

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Expose-Headers", "mcp-session-id");
  next();
});
app.use(express.json());

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Transports by sessionId

const createTransport = async (req: express.Request): Promise<Transport> => {
  const query = req.query;

  const transportType = query.transportType as string;

  if (transportType === "stdio") {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};
    const env = { ...process.env, ...defaultEnvironment, ...queryEnv };

    const { cmd, args } = findActualExecutable(command, origArgs);

    console.log(`🚀 Stdio transport: command=${cmd}, args=${args}`);

    // Launch the MCP server process and log output
    const child = launchMCPServer(cmd, args, env);
    // For now, just return the process object (integration with protocol comes next)
    return child;
  } else if (transportType === "sse") {
    const url = query.url as string;
    const headers: HeadersInit = {
      Accept: "text/event-stream",
    };

    for (const key of SSE_HEADERS_PASSTHROUGH) {
      if (req.headers[key] === undefined) {
        continue;
      }

      const value = req.headers[key];
      headers[key] = Array.isArray(value) ? value[value.length - 1] : value;
    }

    const transport = new SSEClientTransport(new URL(url), {
      eventSourceInit: {
        fetch: (url, init) => fetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else if (transportType === "streamable-http") {
    const headers: HeadersInit = {
      Accept: "text/event-stream, application/json",
    };

    for (const key of STREAMABLE_HTTP_HEADERS_PASSTHROUGH) {
      if (req.headers[key] === undefined) {
        continue;
      }

      const value = req.headers[key];
      headers[key] = Array.isArray(value) ? value[value.length - 1] : value;
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(query.url as string),
      {
        requestInit: {
          headers,
        },
      },
    );
    await transport.start();
    return transport;
  } else {
    console.error(`❌ Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

let backingServerTransport: Transport | undefined;

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  console.log(`📥 Received GET message for sessionId ${sessionId}`);
  try {
    const transport = webAppTransports.get(
      sessionId,
    ) as StreamableHTTPServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (error) {
    console.error("❌ Error in /mcp route:", error);
    res.status(500).json(error);
  }
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  console.log(`📥 Received POST message for sessionId ${sessionId}`);
  if (!sessionId) {
    try {
      console.log("🔄 New streamable-http connection");
      try {
        await backingServerTransport?.close();
        backingServerTransport = await createTransport(req);
      } catch (error) {
        if (error instanceof SseError && error.code === 401) {
          console.error(
            "🔒 Received 401 Unauthorized from MCP server:",
            error.message,
          );
          res.status(401).json(error);
          return;
        }

        throw error;
      }

      console.log("✨ Connected MCP client to backing server transport");

      const webAppTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          webAppTransports.set(sessionId, webAppTransport);
          console.log("✨ Created streamable web app transport " + sessionId);
        },
      });

      await webAppTransport.start();

      mcpProxy({
        transportToClient: webAppTransport,
        transportToServer: backingServerTransport,
      });

      await (webAppTransport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
        req.body,
      );
    } catch (error) {
      console.error("❌ Error in /mcp POST route:", error);
      res.status(500).json(error);
    }
  } else {
    try {
      const transport = webAppTransports.get(
        sessionId,
      ) as StreamableHTTPServerTransport;
      if (!transport) {
        res.status(404).end("Transport not found for sessionId " + sessionId);
      } else {
        await (transport as StreamableHTTPServerTransport).handleRequest(
          req,
          res,
        );
      }
    } catch (error) {
      console.error("❌ Error in /mcp route:", error);
      res.status(500).json(error);
    }
  }
});

app.get("/stdio", async (req, res) => {
  try {
    console.log("🔄 New connection (custom stdio proxy)");

    const command = req.query.command as string;
    const origArgs = shellParseArgs(req.query.args as string) as string[];
    const queryEnv = req.query.env ? JSON.parse(req.query.env as string) : {};
    const env = { ...process.env, ...defaultEnvironment, ...queryEnv };
    const { cmd, args } = findActualExecutable(command, origArgs);

    // Determine the intended server name
    let serverName = req.query.serverName as string;
    if (!serverName) {
      // Fallback: if using npx, use the first arg as the server name if available
      if (cmd === 'npx' && Array.isArray(args) && args.length > 0) {
        serverName = args[0];
      } else {
        serverName = cmd || 'unknown';
      }
    }

    // Launch the MCP server process and log output
    const child = launchMCPServer(cmd, args, env, serverName);

    // Set up JSON-RPC proxy between HTTP client and MCP server process
    req.setEncoding('utf8');
    res.setHeader('Content-Type', 'application/json');

    // Buffer for stdout data
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let boundary;
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line) {
          try {
            const json = JSON.parse(line);
            res.write(JSON.stringify(json) + '\n');
          } catch (err) {
            logServer(serverName, `[proxy] Failed to parse MCP server stdout as JSON: ${line}`);
          }
        }
      }
    });

    // Forward client request body to MCP server stdin
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (body) {
        try {
          // Assume body is a JSON-RPC message or array
          const messages = Array.isArray(JSON.parse(body)) ? JSON.parse(body) : [JSON.parse(body)];
          for (const msg of messages) {
            child.stdin.write(JSON.stringify(msg) + '\n');
          }
        } catch (err) {
          logServer(serverName, `[proxy] Failed to parse client request as JSON: ${body}`);
        }
      }
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      res.end();
      logServer(serverName, `[proxy] MCP server process exited with code ${code}, signal ${signal}`);
    });

    // Handle errors
    child.on('error', (err) => {
      res.status(500).end();
      logServer(serverName, `[proxy] MCP server process error: ${err}`);
    });
  } catch (error) {
    console.error("❌ Error in /stdio route (custom proxy):", error);
    res.status(500).json(error);
  }
});

app.get("/sse", async (req, res) => {
  try {
    try {
      await backingServerTransport?.close();
      backingServerTransport = await createTransport(req);
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
          "🔒 Received 401 Unauthorized from MCP server:",
          error.message,
        );
        res.status(401).json(error);
        return;
      }

      throw error;
    }

    const webAppTransport = new SSEServerTransport("/message", res);
    webAppTransports.set(webAppTransport.sessionId, webAppTransport);

    await webAppTransport.start();

    mcpProxy({
      transportToClient: webAppTransport,
      transportToServer: backingServerTransport,
    });
  } catch (error) {
    console.error("❌ Error in /sse route:", error);
    res.status(500).json(error);
  }
});

app.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    console.log(`📥 Received message for sessionId ${sessionId}`);

    const transport = webAppTransports.get(
      sessionId as string,
    ) as SSEServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("❌ Error in /message route:", error);
    res.status(500).json(error);
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

app.get("/config", (req, res) => {
  try {
    res.json({
      defaultEnvironment,
      defaultCommand: values.env,
      defaultArgs: values.args,
    });
  } catch (error) {
    console.error("❌ Error in /config route:", error);
    res.status(500).json(error);
  }
});

// Logging endpoint
app.post('/api/log', (req, res) => {
  const { type, serverName, message } = req.body;
  console.log('Received log:', { type, serverName, message });
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  if (type === 'server' && serverName) {
    logServer(serverName, message);
  } else {
    logGeneral(message);
  }
  res.sendStatus(200);
});

// Log file viewer endpoint
app.get('/api/logs/:serverName', (req, res) => {
  const { serverName } = req.params;
  const logPath = path.join(logsDir, `server-${serverName}.log`);
  console.log('[LogViewer] Looking for log file:', logPath, fs.existsSync(logPath));
  if (!fs.existsSync(logPath)) {
    return res.status(404).send('Log file not found');
  }
  res.type('text/plain');
  fs.createReadStream(logPath).pipe(res);
});

// Function to find an available port
const findAvailablePort = async (startPort: number): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(startPort, () => {
      const port = (server.address() as any)?.port;
      server.close(() => {
        resolve(port);
      });
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        // Port is in use, try the next one
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
};

const PORT = process.env.PORT || 6277;

// Start server with dynamic port finding
const startServer = async () => {
  try {
    const availablePort = await findAvailablePort(Number(PORT));

    const server = app.listen(availablePort);
    server.on("listening", () => {
      if (availablePort !== Number(PORT)) {
        console.log(
          `⚠️  Port ${PORT} was in use, using available port ${availablePort} instead`,
        );
      }

      console.log(
        `\x1b[32m%s\x1b[0m`,
        `⚙️ Proxy server listening on port ${availablePort}`,
      );
    });
    server.on("error", (err) => {
      console.error(`❌ Server error: ${err.message}`);
      process.exit(1);
    });
  } catch (error) {
    console.error(`❌ Failed to start server: ${error}`);
    process.exit(1);
  }
};

startServer();
