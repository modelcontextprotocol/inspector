import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import type { Resource } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { AppElicitationRequest } from "@inspector/core/mcp/appElicitation.js";
import { renderWithMantine } from "../test/renderWithMantine";
import type { AppBridgeFactoryDeps } from "../components/elements/AppRenderer/createAppBridgeFactory";
import { useMcpApps, type McpApps } from "./useMcpApps";

const { notificationsMock, createFactoryMock, publishMock } = vi.hoisted(
  () => ({
    notificationsMock: { show: vi.fn() },
    createFactoryMock: vi.fn(),
    publishMock: vi.fn(),
  }),
);

vi.mock("@mantine/notifications", () => ({
  notifications: notificationsMock,
}));

// The two bridge factories are what this hook is mostly *for*, and everything
// interesting about them is in the deps object it hands `createAppBridgeFactory`
// — which resource meta a URI resolves to, which client `readResource` reaches,
// which toast an error raises. Standing in for the real factory is what makes
// those readable: the real one needs a live sandbox iframe and an SDK client
// before it will even return, and would answer none of these questions.
vi.mock("../components/elements/AppRenderer/createAppBridgeFactory", () => ({
  createAppBridgeFactory: createFactoryMock,
}));

vi.mock("../lib/publishAppDocument", () => ({
  publishAppDocument: publishMock,
}));

vi.mock("../lib/authToken", () => ({
  getAuthToken: () => "test-token",
}));

/**
 * A distinct client identity per call. `Object.create` does not run the
 * constructor, so this is a real `InspectorClient` prototype chain with no
 * transport behind it — enough for a hook that only stores the reference and
 * calls the two methods stubbed here.
 */
const client = (over: Record<string, unknown> = {}): InspectorClient =>
  Object.assign(
    Object.create(InspectorClient.prototype),
    over,
  ) as InspectorClient;

const resource = (uri: string, meta?: Record<string, unknown>): Resource => ({
  uri,
  name: uri,
  ...(meta && { _meta: meta }),
});

interface Harness {
  hook: () => McpApps;
  rerender: (next: {
    inspectorClient?: InspectorClient | null;
    configBaseUrl?: string;
    resources?: Resource[];
  }) => void;
}

function harness(
  initial: {
    inspectorClient?: InspectorClient | null;
    configBaseUrl?: string;
    resources?: Resource[];
  } = {},
): Harness {
  let latest: McpApps | undefined;
  const props = (over: typeof initial) => ({
    inspectorClient: null,
    configBaseUrl: "http://localhost:6274",
    resources: [] as Resource[],
    ...over,
  });
  function Probe(p: Required<typeof initial>) {
    latest = useMcpApps(p);
    return null;
  }
  const { rerender } = renderWithMantine(<Probe {...props(initial)} />);
  return {
    hook: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    rerender: (next) => {
      act(() => {
        rerender(<Probe {...props(next)} />);
      });
    },
  };
}

/** The deps the Nth `createAppBridgeFactory` call was made with. */
const depsOf = (call: number): AppBridgeFactoryDeps =>
  createFactoryMock.mock.calls[call]?.[0] as AppBridgeFactoryDeps;

/** The most recent sandbox (non-elicitation) and elicitation dep objects. */
function latestDeps(): {
  sandbox: AppBridgeFactoryDeps;
  elicitation: AppBridgeFactoryDeps;
} {
  const all = createFactoryMock.mock.calls.map(
    (c) => c[0] as AppBridgeFactoryDeps,
  );
  const sandbox = all.filter((d) => !d.advertiseElicitation).at(-1);
  const elicitation = all.filter((d) => d.advertiseElicitation).at(-1);
  if (!sandbox || !elicitation) throw new Error("factories were not built");
  return { sandbox, elicitation };
}

const elicitationRequest = (
  requestId: string,
  signal: AbortSignal,
): AppElicitationRequest => ({
  requestId,
  resourceUri: "ui://demo/form.html",
  params: {
    message: "pick one",
    requestedSchema: {
      type: "object",
      properties: { choice: { type: "string" } },
    },
  },
  signal,
});

describe("useMcpApps", () => {
  beforeEach(() => {
    notificationsMock.show.mockReset();
    publishMock.mockReset();
    createFactoryMock.mockReset();
    // A fresh identity per call so a rebuilt factory is observable.
    createFactoryMock.mockImplementation(() => vi.fn());
  });

  it("builds one sandbox factory and one elicitation factory", () => {
    const h = harness();
    expect(createFactoryMock).toHaveBeenCalledTimes(2);
    expect(depsOf(0).advertiseElicitation).toBeUndefined();
    expect(depsOf(1).advertiseElicitation).toBe(true);
    expect(h.hook().sandboxBridgeFactory).not.toBe(
      h.hook().elicitationBridgeFactory,
    );
  });

  it("keeps both factory identities stable across an unrelated re-render", () => {
    const c = client();
    const h = harness({ inspectorClient: c });
    const first = h.hook();
    h.rerender({ inspectorClient: c, resources: [resource("ui://a")] });
    expect(h.hook().sandboxBridgeFactory).toBe(first.sandboxBridgeFactory);
    expect(h.hook().elicitationBridgeFactory).toBe(
      first.elicitationBridgeFactory,
    );
    expect(createFactoryMock).toHaveBeenCalledTimes(2);
  });

  it("rebuilds both factories when the client is replaced", () => {
    const h = harness({ inspectorClient: client() });
    const first = h.hook();
    h.rerender({ inspectorClient: client() });
    expect(h.hook().sandboxBridgeFactory).not.toBe(first.sandboxBridgeFactory);
    expect(h.hook().elicitationBridgeFactory).not.toBe(
      first.elicitationBridgeFactory,
    );
    expect(createFactoryMock).toHaveBeenCalledTimes(4);
  });

  it("resolves listed resource meta against the latest listing", () => {
    const h = harness({ resources: [resource("ui://a", { ui: { csp: {} } })] });
    expect(latestDeps().sandbox.getListedResourceMeta?.("ui://a")).toEqual({
      ui: { csp: {} },
    });
    expect(
      latestDeps().sandbox.getListedResourceMeta?.("ui://b"),
    ).toBeUndefined();

    // The listing is read through a ref, so a new page arriving is visible to
    // the factory that was built before it without rebuilding the factory.
    h.rerender({ resources: [resource("ui://b", { ui: {} })] });
    expect(latestDeps().sandbox.getListedResourceMeta?.("ui://b")).toEqual({
      ui: {},
    });
    expect(
      latestDeps().sandbox.getListedResourceMeta?.("ui://a"),
    ).toBeUndefined();
  });

  it("returns undefined meta for a listing entry that carries none", () => {
    harness({ resources: [resource("ui://a")] });
    expect(
      latestDeps().sandbox.getListedResourceMeta?.("ui://a"),
    ).toBeUndefined();
  });

  describe("getClient", () => {
    it("hands the live client's app-renderer client to both factories", () => {
      const inner = { id: "sdk" };
      const c = client({ getAppRendererClient: () => inner });
      harness({ inspectorClient: c });
      expect(latestDeps().sandbox.getClient()).toBe(inner);
      expect(latestDeps().elicitation.getClient()).toBe(inner);
    });

    it("is null while disconnected", () => {
      harness();
      expect(latestDeps().sandbox.getClient()).toBeNull();
      expect(latestDeps().elicitation.getClient()).toBeNull();
    });

    it("is null when the client has no app-renderer client", () => {
      const c = client({ getAppRendererClient: () => undefined });
      harness({ inspectorClient: c });
      expect(latestDeps().sandbox.getClient()).toBeNull();
      expect(latestDeps().elicitation.getClient()).toBeNull();
    });
  });

  describe("readResource", () => {
    it("returns the invocation result for both factories", async () => {
      const result = { contents: [] };
      const c = client({
        readResource: vi.fn().mockResolvedValue({ result }),
      });
      harness({ inspectorClient: c });
      await expect(latestDeps().sandbox.readResource("ui://a")).resolves.toBe(
        result,
      );
      await expect(
        latestDeps().elicitation.readResource("ui://a"),
      ).resolves.toBe(result);
    });

    it("rejects while disconnected", async () => {
      harness();
      await expect(latestDeps().sandbox.readResource("ui://a")).rejects.toThrow(
        "No MCP client connected.",
      );
      await expect(
        latestDeps().elicitation.readResource("ui://a"),
      ).rejects.toThrow("No MCP client connected.");
    });
  });

  describe("onResourceError", () => {
    it("names the Apps tab for the sandbox factory", () => {
      harness();
      latestDeps().sandbox.onResourceError?.(new Error("404"));
      expect(notificationsMock.show).toHaveBeenCalledWith({
        title: "App resource failed to load",
        message: "404",
        color: "red",
      });
    });

    it("names the elicitation modal for the elicitation factory", () => {
      harness();
      latestDeps().elicitation.onResourceError?.(new Error("boom"));
      expect(notificationsMock.show).toHaveBeenCalledWith({
        title: "Elicitation app failed to load",
        message: "boom",
        color: "red",
      });
    });
  });

  describe("publishAppDocument", () => {
    it("posts the document against the configured base URL", async () => {
      publishMock.mockResolvedValue("http://127.0.0.1:6278/app-document/x");
      harness({ configBaseUrl: "http://127.0.0.1:6274" });
      const doc = { html: "<p>hi</p>", csp: "default-src 'none'" };
      await expect(
        latestDeps().sandbox.publishAppDocument?.(doc),
      ).resolves.toBe("http://127.0.0.1:6278/app-document/x");
      expect(publishMock).toHaveBeenCalledWith(doc, {
        baseUrl: "http://127.0.0.1:6274",
        authToken: "test-token",
      });
    });

    it("rebuilds the factories when the base URL changes", () => {
      const h = harness({ configBaseUrl: "http://a" });
      const first = h.hook().sandboxBridgeFactory;
      h.rerender({ configBaseUrl: "http://b" });
      expect(h.hook().sandboxBridgeFactory).not.toBe(first);
    });
  });

  describe("app elicitations", () => {
    it("starts with no entries and a stable handler identity", () => {
      const h = harness();
      const first = h.hook();
      expect(first.appElicitations).toEqual([]);
      h.rerender({ resources: [resource("ui://a")] });
      expect(h.hook().newAppElicitationSession).toBe(
        first.newAppElicitationSession,
      );
      expect(h.hook().handleAppElicitationSettle).toBe(
        first.handleAppElicitationSettle,
      );
      expect(h.hook().handleAppElicitationFail).toBe(
        first.handleAppElicitationFail,
      );
    });

    it("surfaces a queued request and settles it with the app's result", async () => {
      const h = harness();
      const session = h.hook().newAppElicitationSession();
      const controller = new AbortController();
      let pending!: Promise<unknown>;
      act(() => {
        pending = session.render(elicitationRequest("r1", controller.signal));
      });
      expect(h.hook().appElicitations).toHaveLength(1);
      expect(h.hook().appElicitations[0]?.requestId).toBe("r1");

      act(() => {
        h.hook().handleAppElicitationSettle("r1", { action: "accept" });
      });
      await expect(pending).resolves.toEqual({ action: "accept" });
      expect(h.hook().appElicitations).toEqual([]);
    });

    it("fails a request back to the native form", async () => {
      const h = harness();
      const session = h.hook().newAppElicitationSession();
      const controller = new AbortController();
      let pending!: Promise<unknown>;
      act(() => {
        pending = session.render(elicitationRequest("r1", controller.signal));
      });
      act(() => {
        h.hook().handleAppElicitationFail("r1", new Error("app died"));
      });
      await expect(pending).rejects.toThrow("app died");
      expect(h.hook().appElicitations).toEqual([]);
    });

    it("closes the previous session when a new client is constructed", async () => {
      const h = harness();
      const first = h.hook().newAppElicitationSession();
      const controller = new AbortController();
      let pending!: Promise<unknown>;
      act(() => {
        pending = first.render(elicitationRequest("r1", controller.signal));
      });
      act(() => {
        h.hook().newAppElicitationSession();
      });
      await expect(pending).rejects.toThrow(
        "Connection replaced before the app answered",
      );
      expect(h.hook().appElicitations).toEqual([]);

      // And the closed session refuses anything it enqueues afterwards — the
      // late entry a disconnecting client can still produce.
      await expect(
        first.render(elicitationRequest("r2", controller.signal)),
      ).rejects.toThrow("App elicitation session is closed");
    });

    it("opens the first session with nothing to close", () => {
      const h = harness();
      expect(() => h.hook().newAppElicitationSession()).not.toThrow();
      expect(h.hook().appElicitations).toEqual([]);
    });

    it("keeps one controller across re-renders", async () => {
      const h = harness();
      const session = h.hook().newAppElicitationSession();
      const controller = new AbortController();
      let pending!: Promise<unknown>;
      act(() => {
        pending = session.render(elicitationRequest("r1", controller.signal));
      });
      h.rerender({ inspectorClient: client() });
      expect(h.hook().appElicitations).toHaveLength(1);
      act(() => {
        h.hook().handleAppElicitationSettle("r1", { action: "cancel" });
      });
      await expect(pending).resolves.toEqual({ action: "cancel" });
    });
  });

  it("exposes a renderer ref that starts empty and stays identical", () => {
    const h = harness();
    const ref = h.hook().appRendererRef;
    expect(ref.current).toBeNull();
    h.rerender({ inspectorClient: client() });
    expect(h.hook().appRendererRef).toBe(ref);
  });
});
