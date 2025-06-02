#!/usr/bin/env node

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import handler from "serve-handler";
import http from "http";
import https from "https";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

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

const requestHandler = (request, response) => {
  return handler(request, response, handlerOptions);
};

const port = process.env.CLIENT_PORT || 6274;
const INSPECTOR_SSL_CERT_PATH = process.env.INSPECTOR_SSL_CERT_PATH;
const INSPECTOR_SSL_KEY_PATH = process.env.INSPECTOR_SSL_KEY_PATH;

let server;

if (INSPECTOR_SSL_CERT_PATH && INSPECTOR_SSL_KEY_PATH) {
  // HTTPS server
  try {
    const options = {
      cert: fs.readFileSync(INSPECTOR_SSL_CERT_PATH),
      key: fs.readFileSync(INSPECTOR_SSL_KEY_PATH)
    };
    server = https.createServer(options, requestHandler);
    server.on("listening", () => {
      console.log(
        `🔍 MCP Inspector is up and running at https://127.0.0.1:${port} 🚀🔒`,
      );
    });
  } catch (error) {
    console.error(`❌ Failed to load SSL certificates: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`🔄 Falling back to HTTP mode`);
    server = http.createServer(requestHandler);
    server.on("listening", () => {
      console.log(
        `🔍 MCP Inspector is up and running at http://127.0.0.1:${port} 🚀 (SSL fallback)`,
      );
    });
  }
} else {
  // HTTP server (default)
  if (!INSPECTOR_SSL_CERT_PATH && !INSPECTOR_SSL_KEY_PATH) {
    console.log(`🔓 No SSL certificates configured - using HTTP`);
    console.log(`💡 To enable HTTPS, set INSPECTOR_SSL_CERT_PATH and INSPECTOR_SSL_KEY_PATH environment variables`);
  } else {
    console.log(`⚠️  Incomplete SSL configuration:`);
    if (!INSPECTOR_SSL_CERT_PATH) console.log(`   Missing INSPECTOR_SSL_CERT_PATH`);
    if (!INSPECTOR_SSL_KEY_PATH) console.log(`   Missing INSPECTOR_SSL_KEY_PATH`);
    console.log(`🔄 Using HTTP mode`);
  }
  
  server = http.createServer(requestHandler);
  server.on("listening", () => {
    console.log(
      `🔍 MCP Inspector is up and running at http://127.0.0.1:${port} 🚀`,
    );
  });
}

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
