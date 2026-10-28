import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A Streamable HTTP server that answers `initialize` and then throttles
 * `tools/list` with a `429` (#2772). Shared by the one-shot CLI's and mcpdo's
 * rate-limit envelope tests, which drive it through each client's own output
 * path.
 *
 * Hand-rolled rather than a composable test server for the reason the web
 * integration test (`inspectorClient-rate-limit.test.ts`) gives: the SDK's own
 * server cannot be made to answer one method with a 429.
 */
export interface ThrottlingServer {
  url: string;
  stop: () => Promise<void>;
}

/** The `Retry-After` header to send, or `undefined` to send none. */
export async function startThrottlingServer(
  retryAfter: string | undefined,
): Promise<ThrottlingServer> {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    // No standalone notification stream; nothing here needs one.
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id?: unknown;
      method: string;
    };
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "tools/list") {
      res.writeHead(429, {
        "content-type": "text/plain",
        ...(retryAfter !== undefined && { "retry-after": retryAfter }),
      });
      res.end("slow down");
      return;
    }
    const reply =
      body.method === "initialize"
        ? {
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "throttling-server", version: "1.0.0" },
            },
          }
        : { error: { code: -32601, message: "Method not found" } };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...reply }));
  };

  const server = createServer((req, res) => {
    // node:http ignores the listener's promise, so settle it here: a body that
    // fails to parse answers 400 rather than surfacing as an unhandled rejection.
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
