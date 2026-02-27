import http from "node:http";
import { once } from "node:events";

const ERROR_MESSAGE =
  "Unsupported protocol version: 2025-11-25 - supported versions: 2025-06-18,2025-03-26,2024-11-05,2024-10-07";

const applyCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
};

export async function startUnsupportedProtocolServer() {
  const server = http.createServer(async (req, res) => {
    applyCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Streamable HTTP transport does an optional GET to establish an SSE stream.
    // Returning 405 is an expected case handled by the SDK.
    if (req.method === "GET") {
      res.statusCode = 405;
      res.end();
      return;
    }

    // Accepts any path; the Inspector URL field can include arbitrary endpoints.
    if (req.method !== "POST") {
      res.statusCode = 404;
      res.end();
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    await once(req, "end");

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: parsed?.id ?? null,
        error: {
          code: -32602,
          message: ERROR_MESSAGE,
        },
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start unsupported protocol fixture server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
