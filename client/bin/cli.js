#!/usr/bin/env node

import fs from "fs";
import http from "http";
import { dirname, join } from "path";
import handler from "serve-handler";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

const server = http.createServer((request, response) => {
  // Check if this is a request for index.html (either directly or via SPA routing)
  if (
    request.url === "/" ||
    request.url === "/index.html" ||
    !request.url.includes(".")
  ) {
    const indexPath = join(distPath, "index.html");
    fs.readFile(indexPath, "utf-8", (err, data) => {
      if (err) {
        response.statusCode = 500;
        response.end(`Error loading index.html: ${err.message}`);
        return;
      }

      // Create a runtime config object with environment variables
      const runtimeConfig = {
        MCP_PROXY_FULL_ADDRESS: process.env.MCP_PROXY_FULL_ADDRESS || "",
        MCP_PROXY_PORT: process.env.SERVER_PORT || "6277",
      };

      // Inject the runtime config as a global object in the HTML
      const scriptTag = `<script>window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};</script>`;
      const injectedData = data.replace("</head>", `${scriptTag}</head>`);

      response.setHeader("Content-Type", "text/html");
      response.end(injectedData);
    });
  } else {
    // For all other assets, use serve-handler as before
    return handler(request, response, {
      public: distPath,
      rewrites: [{ source: "/**", destination: "/index.html" }],
    });
  }
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
