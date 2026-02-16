#!/usr/bin/env node

import open from "open";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import handler from "serve-handler";
import http from "http";
import net from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

const port = parseInt(process.env.CLIENT_PORT || "6274", 10);
const host = process.env.HOST || "localhost";

// Check port availability before attempting to bind.
// Prevents confusing EADDRINUSE errors from stale processes.
function checkPort(targetHost, targetPort) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      resolve(false);
    });
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(targetPort, targetHost);
  });
}

const portFree = await checkPort(host, port);
if (!portFree) {
  console.error(
    `❌  MCP Inspector PORT IS IN USE at http://${host}:${port} ❌ `,
  );
  console.error(
    `💡 To fix: run "lsof -ti:${port} | xargs kill -9" to free the port, or set CLIENT_PORT to use a different port.`,
  );
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const handlerOptions = {
    public: distPath,
    rewrites: [{ source: "/**", destination: "/index.html" }],
    headers: [
      {
        // Ensure index.html is never cached
        source: "index.html",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, max-age=0",
          },
        ],
      },
      {
        // Allow long-term caching for hashed assets
        source: "assets/**",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ],
  };

  return handler(request, response, handlerOptions);
});

server.on("listening", () => {
  const url = process.env.INSPECTOR_URL || `http://${host}:${port}`;
  console.log(`\n🚀 MCP Inspector is up and running at:\n   ${url}\n`);
  if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
    console.log(`🌐 Opening browser...`);
    open(url);
  }
});
server.on("error", (err) => {
  if (err.message.includes(`EADDRINUSE`)) {
    console.error(
      `❌  MCP Inspector PORT IS IN USE at http://${host}:${port} ❌ `,
    );
  } else {
    throw err;
  }
  process.exit(1);
});

// Graceful shutdown: properly close the HTTP server so the port is
// released immediately instead of lingering in CLOSE_WAIT state.
function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  // Force exit if close takes too long (e.g. hanging connections)
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, host);
