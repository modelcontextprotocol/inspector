#!/usr/bin/env node

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import handler from "serve-handler";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: distPath,
    rewrites: [{ source: "/**", destination: "/index.html" }],
  });
});

const port = process.env.PORT || 6274;
server.on("listening", () => {
  console.log(
    `🔍 MCP Inspector is up and running at http://127.0.0.1:${port} 🚀`,
  );
});
server.on("error", (err) => {
  if (err.message.includes(`EADDRINUSE`)) {
    console.error(
      `❌  MCP Inspector PORT IS IN USE at http://127.0.0.1:${port} ❌ `,
    );
  } else {
    throw err;
  }
});
server.listen(port);
