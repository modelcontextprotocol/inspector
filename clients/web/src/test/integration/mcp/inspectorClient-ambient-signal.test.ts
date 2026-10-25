import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  type TestServerHttp,
  type ResourceTemplateDefinition,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * #1783 — the ambient request signal must cancel an in-flight *non-tool*
 * request, the same way `cancelToolCall()` cancels a tool call.
 *
 * The daemon serializes every method on a connection, so a `resources/read`
 * (or any list, `prompts/get`, …) the server never answers held the
 * per-connection rpc queue slot forever once the caller hung up — wedging the
 * whole connection until a reconnect. Core only ever threaded a cancellation
 * signal into *tool* calls; every other method called `getRequestOptions`
 * with no signal, so there was nothing for a caller disconnect to abort.
 *
 * The fix is an ambient request signal the daemon sets for the span of one
 * command: `getRequestOptions` folds it into *every* request's options. This
 * drives the whole chain a real caller drives — InspectorClient ->
 * transport -> a real test server — and asserts at the far end, on the
 * server's own request abort signal. Nothing shallower reaches it: a unit
 * test of `getRequestOptions` cannot prove the signal survives the SDK and the
 * wire, which is the entire failure mode.
 */
describe("ambient request signal cancels non-tool requests (#1783)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
  } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /**
   * A resource template whose read never returns on its own. It reports when
   * the read started and whether the server-side request signal — which the
   * SDK aborts when the client cancels the request — ever fired.
   */
  function slowTemplate(): {
    template: ResourceTemplateDefinition;
    started: Promise<void>;
    aborted: Promise<boolean>;
  } {
    const started = deferred<void>();
    const aborted = deferred<boolean>();
    const template: ResourceTemplateDefinition = {
      name: "slow",
      uriTemplate: "slow://item/{id}",
      handler: (_uri, _params, _context, extra) => {
        extra?.signal?.addEventListener("abort", () => aborted.resolve(true), {
          once: true,
        });
        started.resolve();
        // Never resolves on its own; only the abort settles the read.
        return new Promise(() => {});
      },
    };
    return { template, started: started.promise, aborted: aborted.promise };
  }

  async function connect(
    template: ResourceTemplateDefinition,
  ): Promise<InspectorClient> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("ambient-signal-test", "1.0.0"),
      tools: [],
      resourceTemplates: [template],
    });
    await started.start();
    server = started;

    const connected = new InspectorClient(
      { type: "streamable-http", url: started.url },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("aborts an in-flight resources/read when the ambient signal fires", async () => {
    const slow = slowTemplate();
    const connected = await connect(slow.template);

    const controller = new AbortController();
    const dispose = connected.setAmbientRequestSignal(controller.signal);

    // A non-tool read that the server never answers.
    const read = connected.readResource("slow://item/1");
    const rejected = expect(read).rejects.toThrow();

    await slow.started;
    controller.abort();

    // The read rejects (the caller is unwedged) and the server observed the
    // cancellation at the far end of the chain.
    await rejected;
    expect(await slow.aborted).toBe(true);

    dispose();
  });

  // A modern-era tool call goes through the task session, not
  // `getRequestOptions`, so the ambient signal has to be folded in on that
  // path separately (#2744: `mcpdo tools/call --load` relies on it to cancel
  // in-flight calls when its caller hangs up).
  it("aborts an in-flight modern-era tool call when the ambient signal fires", async () => {
    const started = deferred<void>();
    const aborted = deferred<boolean>();
    const slowServer = createTestServerHttp({
      serverInfo: createTestServerInfo("ambient-signal-modern", "1.0.0"),
      tools: [
        {
          name: "slow_tool",
          description: "Runs until the client cancels it",
          handler: (_params, _context, extra) => {
            extra?.signal?.addEventListener(
              "abort",
              () => aborted.resolve(true),
              { once: true },
            );
            started.resolve();
            // Never settles on its own; only the abort ends the call.
            return new Promise(() => {});
          },
        },
      ],
      modern: {},
    });
    await slowServer.start();
    server = slowServer;

    const connected = new InspectorClient(
      { type: "streamable-http", url: slowServer.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    await connected.connect();
    client = connected;
    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "slow_tool");

    const controller = new AbortController();
    const dispose = connected.setAmbientRequestSignal(controller.signal);
    const call = connected.callTool(tool!, {});
    const rejected = expect(call).rejects.toThrow();

    await started.promise;
    controller.abort();

    await rejected;
    expect(await aborted.promise).toBe(true);
    dispose();
  });

  it("leaves a normal request untouched when the ambient signal never fires", async () => {
    // A control: setting an ambient signal that is never aborted must not break
    // an ordinary request. Uses a template that answers immediately.
    const template: ResourceTemplateDefinition = {
      name: "fast",
      uriTemplate: "fast://item/{id}",
      handler: async (uri) => ({
        contents: [{ uri: uri.href, text: "ok" }],
      }),
    };
    const connected = await connect(template);

    const controller = new AbortController();
    const dispose = connected.setAmbientRequestSignal(controller.signal);

    const { result } = await connected.readResource("fast://item/1");
    const first = result.contents[0];
    expect(first && "text" in first ? first.text : undefined).toBe("ok");

    dispose();
  });
});
