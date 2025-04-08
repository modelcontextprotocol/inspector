#!/usr/bin/env node

import fs from "fs";
import http from "http";
import https from "https";
import { dirname, join } from "path";
import handler from "serve-handler";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

// Function to determine the MCP server URL
const getMcpServerUrl = () => {
  if (process.env.MCP_PROXY_FULL_ADDRESS) {
    return process.env.MCP_PROXY_FULL_ADDRESS;
  }

  // Use current host with custom port if specified
  const port = process.env.SERVER_PORT || "6277";
  // Default to http://localhost:port
  return `http://localhost:${port}`;
};

const server = http.createServer((request, response) => {
  // Handle the /config endpoint as a proxy to the MCP server
  if (request.url === "/config") {
    const mcpServerUrl = getMcpServerUrl();
    const configUrl = `${mcpServerUrl}/config`;

    try {
      const clientModule = mcpServerUrl.startsWith("https:") ? https : http;
      const proxyReq = clientModule.request(configUrl, (proxyRes) => {
        // Capture the response data to modify it
        let data = "";
        proxyRes.on("data", (chunk) => {
          data += chunk;
        });

        proxyRes.on("end", () => {
          try {
            // Parse the JSON response
            const jsonResponse = JSON.parse(data);

            // Add the MCP_PROXY_FULL_ADDRESS to the response
            jsonResponse.config = {
              MCP_PROXY_FULL_ADDRESS: { value: mcpServerUrl },
            };

            // Send the modified response
            response.writeHead(proxyRes.statusCode, {
              "Content-Type": "application/json",
            });
            response.end(JSON.stringify(jsonResponse));
          } catch (e) {
            // If parsing fails, just forward the original response
            response.writeHead(proxyRes.statusCode, proxyRes.headers);
            response.end(data);
          }
        });
      });

      proxyReq.on("error", (err) => {
        console.error(`Error proxying request to ${configUrl}:`, err.message);
        response.statusCode = 500;
        response.end(
          JSON.stringify({
            error: "Failed to connect to MCP server",
            defaultEnvironment: {},
            mcpServerUrl: mcpServerUrl,
          }),
        );
      });

      request.pipe(proxyReq);
    } catch (error) {
      console.error(`Error setting up proxy to ${configUrl}:`, error.message);
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: "Failed to connect to MCP server",
          defaultEnvironment: {},
          mcpServerUrl: mcpServerUrl,
        }),
      );
    }
  }
  // Check if this is a request for index.html (either directly or via SPA routing)
  else if (
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

      response.setHeader("Content-Type", "text/html");
      response.end(data);
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
