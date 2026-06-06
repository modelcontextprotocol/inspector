import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ErrorCode,
  McpError,
  UrlElicitationRequiredError,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ElicitRequestURLParams,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { UrlElicitationLoopError } from "@inspector/core/mcp/urlElicitation.js";
import type { CreateTransport } from "@inspector/core/mcp/types.js";

// The client is never connected in these tests, so the transport factory is
// never invoked — a throwing stub satisfies the required environment seam.
const noopTransport: CreateTransport = () => {
  throw new Error("transport should not be created in these tests");
};

const elicitation: ElicitRequestURLParams = {
  mode: "url",
  url: "https://example.com/authorize",
  message: "Authorize to continue.",
  elicitationId: "elicit-1",
};

const tool = {
  name: "trigger-url-elicitation",
  inputSchema: { type: "object" },
} as Tool;

const okResult = { content: [{ type: "text", text: "done" }] };

type FakeClient = {
  callTool: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

/**
 * Build an InspectorClient with its internal SDK client replaced by a fake, so
 * we can drive `callTool` through the URL-elicitation error path without a live
 * server. The client is never connected; `callTool` only needs the injected
 * `callTool`/`request` methods plus the (connection-independent) helpers.
 */
function makeClient(fake: FakeClient): InspectorClient {
  const client = new InspectorClient(
    { type: "stdio", command: "noop", args: [] },
    { elicit: { url: true }, environment: { transport: noopTransport } },
  );
  (client as unknown as { client: FakeClient }).client = fake;
  return client;
}

/**
 * Count the failed `toolCallResultChange` events a client records. Used to lock
 * in the "record a failure exactly once" invariant on the terminal error paths.
 */
function trackFailedDispatches(client: InspectorClient): () => number {
  let count = 0;
  client.addEventListener("toolCallResultChange", (e) => {
    if (!e.detail.success) count += 1;
  });
  return () => count;
}

describe("InspectorClient URL-elicitation error path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the URL elicitation, then retries the call on accept", async () => {
    let attempt = 0;
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new UrlElicitationRequiredError([elicitation]);
        }
        return okResult;
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);

    const pending = client.callTool(tool, {});

    await vi.waitFor(() =>
      expect(client.getPendingElicitations()).toHaveLength(1),
    );
    const queued = client.getPendingElicitations()[0];
    expect(queued.request.params).toMatchObject({
      mode: "url",
      url: elicitation.url,
      elicitationId: elicitation.elicitationId,
    });

    await queued.respond({ action: "accept" });

    const invocation = await pending;
    expect(invocation.success).toBe(true);
    expect(fake.callTool).toHaveBeenCalledTimes(2);
    expect(client.getPendingElicitations()).toHaveLength(0);
  });

  it("processes multiple required elicitations in order before retrying", async () => {
    const second: ElicitRequestURLParams = {
      ...elicitation,
      elicitationId: "elicit-2",
      url: "https://example.com/second",
    };
    let attempt = 0;
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new UrlElicitationRequiredError([elicitation, second]);
        }
        return okResult;
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);

    const pending = client.callTool(tool, {});

    // First elicitation is presented; accept it.
    await vi.waitFor(() =>
      expect(client.getPendingElicitations()).toHaveLength(1),
    );
    expect(client.getPendingElicitations()[0].request.params).toMatchObject({
      elicitationId: "elicit-1",
    });
    await client.getPendingElicitations()[0].respond({ action: "accept" });

    // Only after the first resolves does the second appear.
    await vi.waitFor(() =>
      expect(client.getPendingElicitations()[0]?.request.params).toMatchObject({
        elicitationId: "elicit-2",
      }),
    );
    await client.getPendingElicitations()[0].respond({ action: "accept" });

    const invocation = await pending;
    expect(invocation.success).toBe(true);
    expect(fake.callTool).toHaveBeenCalledTimes(2);
  });

  it("aborts the call (no retry) when the user cancels a required elicitation", async () => {
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        throw new UrlElicitationRequiredError([elicitation]);
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);
    const failedDispatches = trackFailedDispatches(client);

    const pending = client.callTool(tool, {});
    await vi.waitFor(() =>
      expect(client.getPendingElicitations()).toHaveLength(1),
    );
    await client.getPendingElicitations()[0].respond({ action: "cancel" });

    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(fake.callTool).toHaveBeenCalledTimes(1);
    // The abort records exactly one failed history entry — not zero, not a
    // duplicate from the generic catch.
    expect(failedDispatches()).toBe(1);
  });

  it("aborts with a loop error when the server re-requests a completed URL", async () => {
    // The server keeps returning the same URL after the user completes it.
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        throw new UrlElicitationRequiredError([elicitation]);
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);
    const failedDispatches = trackFailedDispatches(client);

    const pending = client.callTool(tool, {});

    // First round: the URL is presented; the user completes it.
    await vi.waitFor(() =>
      expect(client.getPendingElicitations()).toHaveLength(1),
    );
    await client.getPendingElicitations()[0].respond({ action: "accept" });

    // The retry returns the same URL; rather than re-prompt, the call aborts.
    await expect(pending).rejects.toBeInstanceOf(UrlElicitationLoopError);
    await expect(pending).rejects.toMatchObject({ url: elicitation.url });
    // Only the initial call + one retry ran; the URL was presented just once.
    expect(fake.callTool).toHaveBeenCalledTimes(2);
    expect(client.getPendingElicitations()).toHaveLength(0);
    // The loop abort records exactly one failed history entry (the accepted
    // first round records nothing).
    expect(failedDispatches()).toBe(1);
  });

  it("rethrows a -32042 error with no elicitations without queuing anything", async () => {
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        throw new McpError(
          ErrorCode.UrlElicitationRequired,
          "This request requires browser-based authorization.",
        );
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);

    await expect(client.callTool(tool, {})).rejects.toMatchObject({
      code: ErrorCode.UrlElicitationRequired,
    });
    expect(client.getPendingElicitations()).toHaveLength(0);
    expect(fake.callTool).toHaveBeenCalledTimes(1);
  });

  it("rethrows an ordinary error unchanged", async () => {
    const fake: FakeClient = {
      callTool: vi.fn(async () => {
        throw new Error("boom");
      }),
      request: vi.fn(),
    };
    const client = makeClient(fake);
    const failed = vi.fn();
    client.addEventListener("toolCallResultChange", (e) => {
      if (!e.detail.success) failed();
    });

    await expect(client.callTool(tool, {})).rejects.toThrow("boom");
    expect(failed).toHaveBeenCalled();
  });
});
