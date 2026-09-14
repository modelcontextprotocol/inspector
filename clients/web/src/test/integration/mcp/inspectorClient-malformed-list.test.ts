import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { MessageLogState } from "@inspector/core/mcp/state/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { LIST_MAX_PAGES } from "@inspector/core/mcp/listSalvage.js";

/**
 * Per-item list salvage against a real connection (#1909).
 *
 * The reported server was PHP, whose empty `annotations` object reaches the
 * wire as `[]` rather than `{}` — one non-conforming entry, and the SDK
 * rejected the whole `resources/templates/list` result, so every template
 * vanished behind "Couldn't load resources".
 *
 * A hand-rolled JSON-RPC server is used rather than a composable test server
 * because the SDK's own server cannot emit these shapes: they are exactly what
 * its types forbid. The transport, the SDK client, and the salvage path are all
 * real.
 */

const MODERN_VERSION = "2026-07-28";

/**
 * One page exactly as the server will put it on the wire.
 *
 * Both fields are `unknown` on purpose: this server exists to serve shapes the
 * spec forbids (a non-array `items`, a numeric `nextCursor`), so the fixture
 * models raw wire data rather than the validated type. Declaring the spec type
 * and casting malformed values through it at each call site would assert the
 * opposite of what these tests are for.
 */
interface ListPage {
  items: unknown;
  nextCursor?: unknown;
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Minimal streamable-HTTP MCP server that answers `initialize` and the list
 * methods it was configured with, returning entries verbatim (malformed ones
 * included).
 */
function startMalformedServer(
  initialPages: {
    resourceTemplates?: ListPage[];
    tools?: ListPage[];
  },
  /** Negotiate the modern era, which is what turns the SEP-2243 gate on. */
  modern = false,
): Promise<{
  url: string;
  stop: () => Promise<void>;
  calls: string[];
  /** Every `cursor` param the server was sent, in order. */
  cursors: (string | undefined)[];
  /** Swap what the server serves next, to model a server that got fixed. */
  setPages: (next: {
    resourceTemplates?: ListPage[];
    tools?: ListPage[];
  }) => void;
}> {
  const calls: string[] = [];
  let pages = initialPages;

  const cursors: (string | undefined)[] = [];
  // Cursor string -> the page index it addresses, learned as pages are served.
  // Modeling it this way (rather than parsing the cursor as a number) is what
  // makes an EMPTY-STRING cursor meaningful: a client that drops it sends no
  // cursor at all, lands back on page one, and duplicates its entries.
  const cursorToIndex = new Map<string, number>();
  const pageFor = (key: "resourceTemplates" | "tools", cursor?: string) => {
    cursors.push(cursor);
    const configured = pages[key] ?? [];
    const index = cursor === undefined ? 0 : (cursorToIndex.get(cursor) ?? 0);
    const page = configured[index] ?? { items: [] };
    // Only a string cursor can address a page; a malformed one is served
    // verbatim so the client can reject it, but it maps to nothing.
    if (typeof page.nextCursor === "string") {
      cursorToIndex.set(page.nextCursor, index + 1);
    }
    return page;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    // The SDK also issues bodyless requests (the SSE GET, the session DELETE on
    // teardown). Answer them without pretending they're JSON-RPC.
    if (raw.length === 0) {
      res.writeHead(405).end();
      return;
    }
    const body = JSON.parse(raw) as {
      id?: unknown;
      method: string;
      params?: { cursor?: string };
    };
    calls.push(body.method);

    // Notifications carry no id and get an empty 202.
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }

    const send = (result: Record<string, unknown>) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // The 2026-07-28 codec requires `resultType` on every result; the legacy
      // leg ignores it.
      res.end(
        JSON.stringify(
          jsonRpcResult(
            body.id,
            modern
              ? {
                  resultType: "complete",
                  // The modern leg also requires the cache hints on a list
                  // result; `ttlMs: 0` means "don't cache", which keeps each
                  // call in these tests a real round trip.
                  ttlMs: 0,
                  cacheScope: "public",
                  ...result,
                }
              : result,
          ),
        ),
      );
    };

    if (body.method === "initialize") {
      send({
        protocolVersion: modern ? MODERN_VERSION : "2025-06-18",
        capabilities: { resources: {}, tools: {} },
        serverInfo: { name: "malformed-list-server", version: "1.0.0" },
      });
      return;
    }
    if (body.method === "server/discover") {
      send({
        supportedVersions: [MODERN_VERSION],
        capabilities: { resources: {}, tools: {} },
        serverInfo: { name: "malformed-list-server", version: "1.0.0" },
      });
      return;
    }
    if (body.method === "resources/templates/list") {
      const page = pageFor("resourceTemplates", body.params?.cursor);
      send({
        resourceTemplates: page.items,
        ...(page.nextCursor !== undefined && { nextCursor: page.nextCursor }),
      });
      return;
    }
    if (body.method === "tools/list") {
      const page = pageFor("tools", body.params?.cursor);
      send({
        tools: page.items,
        ...(page.nextCursor !== undefined && { nextCursor: page.nextCursor }),
      });
      return;
    }
    send({});
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
        calls,
        cursors,
        setPages: (next) => {
          pages = next;
        },
        stop: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

const VALID_TEMPLATE = {
  name: "full_annotations",
  uriTemplate: "annotated://full/{id}",
  annotations: { audience: ["user"], priority: 0.8 },
};
// The #1909 shape: `[]` where the spec says object.
const PHP_EMPTY_ANNOTATIONS = {
  name: "array_annotations",
  uriTemplate: "annotated://array/{id}",
  annotations: [],
};
const EMPTY_OBJECT_ANNOTATIONS = {
  name: "empty_annotations",
  uriTemplate: "annotated://empty/{id}",
  annotations: {},
};

describe("InspectorClient list salvage (#1909)", () => {
  let client: InspectorClient | null = null;
  let stopServer: (() => Promise<void>) | null = null;

  async function connectTo(url: string, era?: "legacy" | "modern") {
    client = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        ...(era ? { versionNegotiation: eraToVersionNegotiation(era) } : {}),
      },
    );
    await client.connect();
    return client;
  }

  beforeEach(() => {
    client = null;
    stopServer = null;
  });

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // Teardown only — the assertions already ran.
    }
    client = null;
    await stopServer?.();
    stopServer = null;
  });

  it("keeps the valid templates and reports the malformed one", async () => {
    const server = await startMalformedServer({
      resourceTemplates: [
        {
          items: [
            EMPTY_OBJECT_ANNOTATIONS,
            PHP_EMPTY_ANNOTATIONS,
            VALID_TEMPLATE,
          ],
        },
      ],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    const { resourceTemplates } = await connected.listAllResourceTemplates();

    // Before the fix this threw, and the panel showed zero templates.
    expect(resourceTemplates.map((t) => t.name)).toEqual([
      "empty_annotations",
      "full_annotations",
    ]);
    expect(connected.getMalformedListItems()).toEqual([
      {
        method: "resources/templates/list",
        index: 1,
        label: "array_annotations",
        reason: expect.stringMatching(/^annotations: /),
      },
    ]);
  });

  it("accepts an empty annotations object without salvaging at all", async () => {
    // `{}` is legal — every Annotations field is optional — so this must take
    // the strict path and report nothing dropped.
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [EMPTY_OBJECT_ANNOTATIONS] }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    const { resourceTemplates } = await connected.listAllResourceTemplates();
    expect(resourceTemplates).toHaveLength(1);
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("emits malformedListItemsChange so the UI can warn", async () => {
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE] }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    const seen: unknown[] = [];
    connected.addEventListener("malformedListItemsChange", (event) => {
      seen.push(event.detail);
    });
    await connected.listAllResourceTemplates();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject([{ label: "array_annotations" }]);
  });

  it("marks the ORIGINAL rejected response, not a salvage page", async () => {
    // The re-walk answers the same method again, so a mark taken afterwards
    // would land on a page that succeeded and leave the invalid response
    // rendering clean — the exact lie #1953 exists to remove.
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE] }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);
    const log = new MessageLogState(connected);

    await connected.listAllResourceTemplates();

    const templateCalls = log
      .getMessages()
      .filter(
        (entry) =>
          "method" in entry.message &&
          entry.message.method === "resources/templates/list",
      );
    // Two exchanges: the strict aggregate that was rejected, then the re-walk.
    expect(templateCalls.length).toBeGreaterThanOrEqual(2);
    expect(templateCalls[0]?.clientError).toContain(
      "Dropped 1 malformed entry",
    );
    for (const later of templateCalls.slice(1)) {
      expect(later.clientError).toBeUndefined();
    }
    log.destroy();
  });

  it("marks the Protocol entry rejected even though the list rendered", async () => {
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE] }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);
    const log = new MessageLogState(connected);

    await connected.listAllResourceTemplates();

    const rejected = log
      .getMessages()
      .filter((entry) => entry.clientError !== undefined);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.at(-1)?.clientError).toContain("Dropped 1 malformed entry");
    log.destroy();
  });

  it("salvages across pages, indexing against the aggregate", async () => {
    const server = await startMalformedServer({
      tools: [
        {
          items: [{ name: "ok_one", inputSchema: { type: "object" } }],
          nextCursor: "1",
        },
        { items: [{ name: "broken", inputSchema: "not-a-schema" }] },
      ],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["ok_one"]);
    expect(connected.getMalformedListItems()).toMatchObject([
      { method: "tools/list", index: 1, label: "broken" },
    ]);
  });

  it("clears a previous report once the server answers cleanly", async () => {
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE] }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    await connected.listAllResourceTemplates();
    expect(connected.getMalformedListItems()).toHaveLength(1);

    // The server is fixed; the next refresh must clear the stale report rather
    // than leaving a warning about entries that are no longer wrong.
    server.setPages({ resourceTemplates: [{ items: [VALID_TEMPLATE] }] });
    await connected.listAllResourceTemplates({ cacheMode: "bypass" });
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("does not readmit a SEP-2243-excluded tool while salvaging", async () => {
    // The strict aggregate is filtered by the SDK, so the salvage path has to
    // reapply the rule: otherwise one ordinary malformed tool anywhere in the
    // list quietly readmits every invalid-header tool beside it, turning a
    // rendering fix into a spec violation (#1632 + #1909).
    const server = await startMalformedServer(
      {
        tools: [
          {
            items: [
              { name: "ok_tool", inputSchema: { type: "object" } },
              // Malformed: trips the salvage fallback.
              { name: "broken", inputSchema: "not-a-schema" },
              // Schema-valid, but its x-mcp-header is not an RFC 9110 token.
              {
                name: "invalid_header_tool",
                inputSchema: {
                  type: "object",
                  properties: {
                    value: {
                      type: "string",
                      "x-mcp-header": "Bad Header",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");
    expect(connected.getProtocolEra()).toBe("modern");

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["ok_tool"]);
    // Still reported as excluded rather than silently gone.
    expect(connected.getExcludedTools().map((x) => x.tool.name)).toEqual([
      "invalid_header_tool",
    ]);
  });

  it("surfaces the ORIGINAL error when the re-walk itself fails", async () => {
    // A malformed `nextCursor` fails the lenient page schema too, so the walk
    // throws its own error. The original is what the caller's list actually
    // failed on — and what `rejectedResponseId` was captured for — so that is
    // the one that must surface.
    const server = await startMalformedServer({
      resourceTemplates: [
        {
          items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE],
          nextCursor: 42,
        },
      ],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    await expect(connected.listAllResourceTemplates()).rejects.toThrow(
      /annotations/,
    );
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("keeps the strict error when a page is not a list at all", async () => {
    // `{ resourceTemplates: "nope" }` is a top-level violation the per-item
    // pass cannot explain; treating it as an empty page would return a
    // silently truncated list and discard the error that was right about it.
    const server = await startMalformedServer({
      resourceTemplates: [{ items: "nope" }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    await expect(connected.listAllResourceTemplates()).rejects.toThrow();
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("sends an empty-string cursor rather than re-fetching page one", async () => {
    // "" is a valid cursor. A truthiness check would drop it, re-request page
    // one, and duplicate its entries until the repeated-cursor guard fired.
    const server = await startMalformedServer({
      resourceTemplates: [
        { items: [PHP_EMPTY_ANNOTATIONS, VALID_TEMPLATE], nextCursor: "" },
        { items: [{ ...VALID_TEMPLATE, name: "page_two" }] },
      ],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    const { resourceTemplates } = await connected.listAllResourceTemplates();
    expect(resourceTemplates.map((t) => t.name)).toEqual([
      "full_annotations",
      "page_two",
    ]);
    expect(server.cursors).toContain("");
  });

  it("marks the exclusion scan's own refused response too", async () => {
    // The scan is a separate exchange from the aggregate's, and its re-fetch
    // moves the method correlation off it — so without marking it here its
    // Protocol entry renders as a clean success the client actually refused.
    const server = await startMalformedServer(
      {
        tools: [
          {
            items: [
              { name: "ok_tool", inputSchema: { type: "object" } },
              { name: "broken", inputSchema: "not-a-schema" },
            ],
          },
        ],
      },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");
    const log = new MessageLogState(connected);

    await connected.listAllTools();

    const marked = log
      .getMessages()
      .filter(
        (entry) =>
          "method" in entry.message &&
          entry.message.method === "tools/list" &&
          entry.clientError !== undefined,
      );
    // Two refused responses: the aggregate's and the scan's.
    expect(marked).toHaveLength(2);
    for (const entry of marked) {
      expect(entry.clientError).toContain("Dropped 1 malformed entry");
    }
    log.destroy();
  });

  it("indexes a dropped tool against the whole aggregate, across pages", async () => {
    // The reported index has to be offset by the RAW entries of PRIOR pages —
    // valid and malformed alike, not just the kept ones. An unlabeled entry's
    // index is all the user has to go on, so a wrong offset points at nothing.
    // This is the aggregate salvage's walk: it owns the `tools/list` report,
    // because it is the walk that produced the list being rendered.
    const server = await startMalformedServer(
      {
        tools: [
          {
            items: [
              { name: "one", inputSchema: { type: "object" } },
              { name: "two", inputSchema: { type: "object" } },
            ],
            nextCursor: "p2",
          },
          // Page two, entry one (index 2 of the whole list) is unlabelable.
          { items: [42, { name: "four", inputSchema: { type: "object" } }] },
        ],
      },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");

    const { tools } = await connected.listAllTools();
    expect(tools.map((t) => t.name)).toEqual(["one", "two", "four"]);
    const reported = connected.getMalformedListItems();
    expect(reported).toHaveLength(1);
    expect(reported[0]?.index).toBe(2);
    expect(reported[0]?.label).toBeUndefined();
  });

  it("leaves the correlation on the original response when it rethrows", async () => {
    // On a rethrow the re-walk has already answered the same method, so the
    // caller's own `markResponseRejected` would land on the lenient page that
    // succeeded. The correlation is restored so the outer mark still finds the
    // response that was actually refused.
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [VALID_TEMPLATE], nextCursor: 42 }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);
    const log = new MessageLogState(connected);

    await expect(connected.listAllResourceTemplates()).rejects.toThrow();
    // Simulates what ManagedListState.refresh() does in its catch.
    connected.markResponseRejected("resources/templates/list", "outer mark");

    const calls = log
      .getMessages()
      .filter(
        (entry) =>
          "method" in entry.message &&
          entry.message.method === "resources/templates/list",
      );
    expect(calls[0]?.clientError).toBe("outer mark");
    for (const later of calls.slice(1)) {
      expect(later.clientError).toBeUndefined();
    }
    log.destroy();
  });

  it("rethrows when the rejection is not about any single entry", async () => {
    // Every entry validates; the result is bad for another reason (a cursor of
    // the wrong type). There is no per-item story, so the original error must
    // survive rather than being swallowed into a partial list.
    const server = await startMalformedServer({
      resourceTemplates: [{ items: [VALID_TEMPLATE], nextCursor: 42 }],
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    await expect(connected.listAllResourceTemplates()).rejects.toThrow();
    expect(connected.getMalformedListItems()).toEqual([]);
  });

  it("keeps the aggregate's report when the scan sees a different list", async () => {
    // Both walks run on a modern connection and they are separate, uncached
    // exchanges. The aggregate is the list being RENDERED, so it owns the
    // report; the scan never writes it. Here the server answers the scan's
    // request with a different malformed shape — which, if the scan published,
    // would leave the warning pointing into a list nobody is looking at.
    const server = await startMalformedServer(
      {
        tools: [
          {
            items: [
              { name: "ok_tool", inputSchema: { type: "object" } },
              { name: "broken", inputSchema: "not-a-schema" },
            ],
          },
        ],
      },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");

    // Serve a DIFFERENT malformed shape to the scan's walk, which runs after
    // the aggregate — so an overwrite is visible as a changed index/label.
    let swapped = false;
    const original = connected.listTools.bind(connected);
    connected.listTools = async (cursor?: string, meta?: object) => {
      if (!swapped) {
        swapped = true;
        server.setPages({
          tools: [
            {
              items: [
                { name: "a", inputSchema: { type: "object" } },
                { name: "b", inputSchema: { type: "object" } },
                { name: "later_break", inputSchema: 42 },
              ],
            },
          ],
        });
      }
      return original(cursor, meta as Record<string, string> | undefined);
    };

    await connected.listAllTools();

    // The aggregate's finding, at the aggregate's index — not the scan's.
    expect(connected.getMalformedListItems()).toEqual([
      {
        method: "tools/list",
        index: 1,
        label: "broken",
        reason: expect.stringMatching(/^inputSchema/),
      },
    ]);
  });

  it("marks the scan's refused response even when the re-fetch is clean", async () => {
    // The list can change between the strict page and the lenient re-fetch. A
    // conforming re-fetch says nothing about the response that was refused, so
    // leaving it unmarked would render a rejected exchange as a clean success.
    const server = await startMalformedServer(
      { tools: [{ items: [{ name: "broken", inputSchema: 42 }] }] },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");
    const log = new MessageLogState(connected);

    // Let the strict call fail, then serve a conforming list to every later
    // request — so the scan's re-fetch finds nothing per-item wrong.
    const original = connected.listTools.bind(connected);
    connected.listTools = async (cursor?: string, meta?: object) => {
      try {
        return await original(
          cursor,
          meta as Record<string, string> | undefined,
        );
      } finally {
        server.setPages({
          tools: [
            { items: [{ name: "fixed", inputSchema: { type: "object" } }] },
          ],
        });
      }
    };

    await connected.refreshExcludedTools();

    const marked = log
      .getMessages()
      .filter(
        (entry) =>
          "method" in entry.message &&
          entry.message.method === "tools/list" &&
          entry.clientError !== undefined,
      );
    expect(marked).toHaveLength(1);
    log.destroy();
  });

  it("stops the salvage walk at the page cap instead of paging forever", async () => {
    // A server whose `nextCursor` never converges but never REPEATS slips the
    // repeated-cursor guard: every cursor is fresh, so the walk had no reason
    // to stop and would page (and accumulate) without bound. The bound is the
    // same `LIST_MAX_PAGES` the SDK aggregate is configured with.
    const server = await startMalformedServer({
      resourceTemplates: Array.from(
        { length: LIST_MAX_PAGES + 40 },
        (_, i) => ({
          items: [PHP_EMPTY_ANNOTATIONS],
          nextCursor: `cursor-${i}`,
        }),
      ),
    });
    stopServer = server.stop;
    const connected = await connectTo(server.url);

    // Truncation is not salvage: with entries still unfetched, returning what
    // we have would present a partial list as complete, so the original
    // validation error stands.
    await expect(connected.listAllResourceTemplates()).rejects.toThrow();
    expect(connected.getMalformedListItems()).toEqual([]);

    const listCalls = server.calls.filter(
      (method) => method === "resources/templates/list",
    );
    // One strict aggregate attempt (rejected on page one), then a salvage walk
    // bounded at exactly the cap. Without the bound this runs to 104 pages —
    // and against a truly endless server, forever.
    expect(listCalls).toHaveLength(1 + LIST_MAX_PAGES);
  });

  it("stops the exclusion scan at the page cap too", async () => {
    // The SEP-2243 scan walks pages of its own, outside the SDK aggregate's
    // cap, so it needs the same bound. Driven directly because a non-converging
    // list trips `listAllTools`'s salvage walk first.
    const server = await startMalformedServer(
      {
        tools: Array.from({ length: LIST_MAX_PAGES + 40 }, (_, i) => ({
          items: [{ name: `tool_${i}`, inputSchema: { type: "object" } }],
          nextCursor: `cursor-${i}`,
        })),
      },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");

    await expect(connected.refreshExcludedTools()).rejects.toThrow(
      /exceeded 64 pages/,
    );
    expect(
      server.calls.filter((method) => method === "tools/list"),
    ).toHaveLength(LIST_MAX_PAGES);
  });

  it("marks the scan's refused response when its own fallback fails", async () => {
    // `tools` is not a list at all, so the scan's lenient re-fetch cannot
    // explain the rejection and rethrows. `listAllTools` catches a failing scan
    // by design (it must never fail the tools list), so nothing downstream
    // would mark the response the client demonstrably refused — it would render
    // as a clean exchange.
    const server = await startMalformedServer(
      { tools: [{ items: "not-a-list" }] },
      true,
    );
    stopServer = server.stop;
    const connected = await connectTo(server.url, "modern");
    const log = new MessageLogState(connected);

    await expect(connected.refreshExcludedTools()).rejects.toThrow();

    const marked = log
      .getMessages()
      .filter(
        (entry) =>
          "method" in entry.message &&
          entry.message.method === "tools/list" &&
          entry.clientError !== undefined,
      );
    // The mark carries the ORIGINAL decode error: the fallback's own failure is
    // a different event from the response being marked.
    expect(marked).toHaveLength(1);
    expect(marked[0]?.clientError).toBeTruthy();
    log.destroy();
  });
});
