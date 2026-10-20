import { describe, it, expect, afterEach } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { serve, type ServerType } from "@hono/node-server";
import { SdkErrorCode, SdkHttpError } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import {
  eraToVersionNegotiation,
  type CreateTransport,
} from "@inspector/core/mcp/types.js";
import type { AnnotatedRateLimitData } from "@inspector/core/mcp/rateLimit.js";

/**
 * Rate-limit recognition against a real connection (#2442).
 *
 * A server that answers `initialize` and then throttles `tools/list` with a
 * `429`. The SDK's `SdkHttpError` keeps the status but drops the response
 * headers, so the `Retry-After` in the message can only have come from the
 * fetch tracker — directly on a Node transport, and relayed on the send error
 * by the web backend on the remote one. Both are driven end to end here.
 *
 * Hand-rolled rather than a composable test server because the SDK's own
 * server cannot be configured to answer one method with a 429, let alone hold
 * one 429's body back while another overtakes it.
 */

interface ToolsListReply {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

interface ThrottlingServer {
  url: string;
  setToolsListReply: (reply: ToolsListReply) => void;
  /**
   * The methods of the overlapping pair (`prompts/list`, `resources/list`), in
   * the order they arrived. The first is answered `429` + `Retry-After: 30`
   * with its body held back; the second `429` + `Retry-After: 5` at once.
   */
  overlapArrivals: () => string[];
  /** Finish the held first response of the overlapping pair. */
  releaseFirstOverlap: () => void;
  stop: () => Promise<void>;
}

const OVERLAPPING = new Set(["prompts/list", "resources/list"]);

const THROTTLED: ToolsListReply = {
  status: 429,
  headers: { "retry-after": "30" },
  body: "slow down",
};

function startThrottlingServer(): Promise<ThrottlingServer> {
  let toolsListReply = THROTTLED;
  const overlapArrivals: string[] = [];
  let releaseFirstOverlap = () => {};

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
      res.writeHead(toolsListReply.status, {
        "content-type": "text/plain",
        ...toolsListReply.headers,
      });
      res.end(toolsListReply.body);
      return;
    }
    if (OVERLAPPING.has(body.method)) {
      overlapArrivals.push(body.method);
      const first = overlapArrivals.length === 1;
      res.writeHead(429, {
        "content-type": "text/plain",
        "retry-after": first ? "30" : "5",
      });
      if (first) {
        // Headers out now, so the 429 is tracked; the SDK's error waits on
        // the body, which only the test releases.
        res.flushHeaders();
        releaseFirstOverlap = () => res.end("first");
      } else {
        res.end("second");
      }
      return;
    }
    const result =
      body.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {}, prompts: {}, resources: {} },
            serverInfo: { name: "throttling-server", version: "1.0.0" },
          }
        : {};
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      /* v8 ignore next -- listen() on a fresh server always yields an AddressInfo */
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        setToolsListReply: (reply) => {
          toolsListReply = reply;
        },
        overlapArrivals: () => [...overlapArrivals],
        releaseFirstOverlap: () => releaseFirstOverlap(),
        stop: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** The web backend on an ephemeral port, as the browser's remote transport sees it. */
function startRemoteBackend(): Promise<{
  server: ServerType;
  transport: CreateTransport;
}> {
  const { app, authToken } = createRemoteApp({
    initialConfig: { defaultEnvironment: {} },
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        resolve({
          server,
          transport: createRemoteTransport({
            baseUrl: `http://127.0.0.1:${info.port}`,
            authToken,
          }),
        });
      },
    );
    server.on("error", reject);
  });
}

/** Poll until `predicate` holds; the failure names what never became true. */
async function waitUntil(
  what: string,
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the request to reject");
}

describe("InspectorClient rate-limit recognition (#2442)", () => {
  let client: InspectorClient | null = null;
  let upstream: ThrottlingServer | null = null;
  let backend: ServerType | null = null;

  async function connectTo(
    url: string,
    transport: CreateTransport = createTransportNode,
  ): Promise<InspectorClient> {
    client = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport },
        // Pinned legacy so the connect is exactly `initialize`.
        versionNegotiation: eraToVersionNegotiation("legacy"),
      },
    );
    await client.connect();
    return client;
  }

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // Teardown only — the assertions already ran.
    }
    client = null;
    await upstream?.stop();
    upstream = null;
    if (backend) {
      const closing = backend;
      await new Promise<void>((done) => closing.close(() => done()));
      backend = null;
    }
  });

  function expectThrottled(caught: unknown): AnnotatedRateLimitData {
    expect(SdkHttpError.isInstance(caught)).toBe(true);
    const error = caught as SdkHttpError;
    // Same class, code and status as the SDK's own error: only the message
    // and the data grew.
    expect(error.code).toBe(SdkErrorCode.ClientHttpNotImplemented);
    expect(error.status).toBe(429);
    return error.data as AnnotatedRateLimitData;
  }

  it("names the throttled request and the server's Retry-After", async () => {
    upstream = await startThrottlingServer();
    const c = await connectTo(upstream.url);

    const caught = await rejectionOf(c.listTools());

    const data = expectThrottled(caught);
    expect((caught as Error).message).toBe(
      "Rate limited by the server (HTTP 429) on tools/list. " +
        "The server asked to retry after 30s. " +
        "Error POSTing to endpoint: slow down",
    );
    expect(data.method).toBe("tools/list");
    expect(data.retryAfter).toBe("30");
    expect(data.retryAfterMs).toBe(30_000);
    expect(SdkHttpError.isInstance((caught as Error).cause)).toBe(true);
  });

  it("says so when the server sent no Retry-After", async () => {
    upstream = await startThrottlingServer();
    upstream.setToolsListReply({ status: 429, body: "slow down" });
    const c = await connectTo(upstream.url);

    const caught = await rejectionOf(c.listTools());

    const data = expectThrottled(caught);
    expect((caught as Error).message).toContain(
      "The server sent no Retry-After header.",
    );
    expect(data.retryAfter).toBeUndefined();
  });

  it("leaves a non-429 failure exactly as the SDK threw it", async () => {
    upstream = await startThrottlingServer();
    upstream.setToolsListReply({
      status: 503,
      headers: { "retry-after": "30" },
      body: "down for maintenance",
    });
    const c = await connectTo(upstream.url);

    const caught = await rejectionOf(c.listTools());

    expect(SdkHttpError.isInstance(caught)).toBe(true);
    expect((caught as SdkHttpError).status).toBe(503);
    expect((caught as Error).message).toBe(
      "Error POSTing to endpoint: down for maintenance",
    );
  });

  it("relays the Retry-After through the web backend", async () => {
    upstream = await startThrottlingServer();
    const started = await startRemoteBackend();
    backend = started.server;
    const c = await connectTo(upstream.url, started.transport);

    const caught = await rejectionOf(c.listTools());

    const data = expectThrottled(caught);
    expect((caught as Error).message).toMatch(
      /^Rate limited by the server \(HTTP 429\) on tools\/list\. The server asked to retry after 30s\. /,
    );
    expect(data.retryAfter).toBe("30");
  });

  /**
   * Two requests throttled at once, the first one's response overtaken by
   * the second's. Each must report its own response's `Retry-After`; picking
   * "the latest 429" would hand the first request the second's 5s.
   */
  async function expectOverlapCorrelated(c: InspectorClient): Promise<void> {
    const first = rejectionOf(c.listPrompts());
    await waitUntil(
      "the first request to arrive",
      () => upstream!.overlapArrivals().length === 1,
    );
    const second = await rejectionOf(c.listResources());
    upstream!.releaseFirstOverlap();
    const firstCaught = await first;

    expect(upstream!.overlapArrivals()).toEqual([
      "prompts/list",
      "resources/list",
    ]);
    expect(expectThrottled(firstCaught).retryAfter).toBe("30");
    expect((firstCaught as Error).message).toContain(
      "on prompts/list. The server asked to retry after 30s.",
    );
    expect(expectThrottled(second).retryAfter).toBe("5");
    expect((second as Error).message).toContain(
      "on resources/list. The server asked to retry after 5s.",
    );
  }

  it("gives each of two overlapping 429s its own Retry-After", async () => {
    upstream = await startThrottlingServer();
    await expectOverlapCorrelated(await connectTo(upstream.url));
  });

  it("gives each of two overlapping 429s its own Retry-After through the web backend", async () => {
    upstream = await startThrottlingServer();
    const started = await startRemoteBackend();
    backend = started.server;
    await expectOverlapCorrelated(
      await connectTo(upstream.url, started.transport),
    );
  });
});
