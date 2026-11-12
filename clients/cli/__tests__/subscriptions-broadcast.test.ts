import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createResourceUpdateBroadcast,
  createTestServerHttp,
  loadConfig,
  resolveConfig,
  setResourceText,
  type ResourceUpdateBroadcast,
  type ResourceUpdateMember,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";

/**
 * The `subscriptions-broadcast-http` showcase config (#2964): a resource
 * update that reaches every subscribed session, so `--load-subscribe` can be
 * tried by hand without writing a server. Without the broadcast, each session
 * of the composable server is its own server, so `update_resource` notifies
 * only the session that called it and a fan-out run reports the rest missed.
 */

const CONFIGS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-servers/configs",
);
const URI = "test://resource_1";

let server: TestServerHttp | null = null;

afterEach(async () => {
  if (server) {
    try {
      await server.stop();
    } catch {
      // ignore
    }
    server = null;
  }
});

/** Start a showcase config in-process, on a port the harness picks. */
async function startConfig(name: string): Promise<{
  url: string;
  hub: ResourceUpdateBroadcast | undefined;
}> {
  const resolved = resolveConfig(loadConfig(path.join(CONFIGS, name)));
  const started = createTestServerHttp({ ...resolved, port: undefined });
  await started.start();
  server = started;
  return { url: started.url, hub: resolved.resourceUpdateBroadcast };
}

/** A `--load-subscribe` fan-out run triggered by `update_resource`. */
function fanoutRun(url: string): string[] {
  return [
    url,
    "--cli",
    "--transport",
    "http",
    "--method",
    "tools/call",
    "--tool-name",
    "update_resource",
    "--tool-arg",
    `uri=${URI}`,
    "--tool-arg",
    "text=v{{seq}}",
    "--load",
    "--load-requests",
    "4",
    "--load-subscribe",
    URI,
    "--load-subscribers",
    "3",
    "--load-subscribe-wait",
    "1",
  ];
}

describe("subscriptions-broadcast-http.json (CLI)", () => {
  it("delivers every update to every subscribed session", async () => {
    const { url, hub } = await startConfig("subscriptions-broadcast-http.json");
    const result = await runCli(fanoutRun(url));
    expectCliSuccess(result);
    expect(expectValidJson(result)).toMatchObject({
      ok: 4,
      fanout: {
        uri: URI,
        mode: "triggered",
        subscribed: 3,
        updates: 4,
        delivered: 12,
        missed: 0,
      },
    });

    // A session opened after the run serves the last update, not the preset.
    const read = await runCli([
      url,
      "--cli",
      "--transport",
      "http",
      "--method",
      "resources/read",
      "--uri",
      URI,
    ]);
    expectCliSuccess(read);
    expect(expectValidJson(read)).toMatchObject({
      contents: [{ uri: URI, text: "v4" }],
    });

    // Every session left the hub when its connection closed.
    expect(hub?.size).toBe(0);
  });

  it("is what the stock legacy config lacks: only the caller is notified", async () => {
    const { url, hub } = await startConfig("subscriptions-legacy-http.json");
    expect(hub).toBeUndefined();
    const result = await runCli(fanoutRun(url));
    expectCliSuccess(result);
    expect(expectValidJson(result)).toMatchObject({
      fanout: { updates: 4, delivered: 4, missed: 8, sessionsMissed: 2 },
    });
  });
});

describe("createResourceUpdateBroadcast", () => {
  function member(subscribed: boolean, failing = false) {
    const applied: Array<[string, string]> = [];
    const m: ResourceUpdateMember = {
      apply: (uri, text) => {
        applied.push([uri, text]);
      },
      notify: async () => {
        if (failing) throw new Error("stream gone");
        return subscribed;
      },
    };
    return { m, applied };
  }

  it("applies to every member and counts the subscribed ones notified", async () => {
    const hub = createResourceUpdateBroadcast();
    const a = member(true);
    const b = member(false);
    const broken = member(true, true);
    hub.join(a.m);
    hub.join(b.m);
    hub.join(broken.m);
    expect(hub.size).toBe(3);

    // A failing send is skipped rather than failing the publish.
    await expect(hub.publish(URI, "v1")).resolves.toBe(1);
    expect(a.applied).toEqual([[URI, "v1"]]);
    expect(b.applied).toEqual([[URI, "v1"]]);
  });

  it("replays the latest update to a late joiner, and stops after leave", async () => {
    const hub = createResourceUpdateBroadcast();
    await hub.publish(URI, "v1");
    await hub.publish(URI, "v2");
    const late = member(true);
    const leave = hub.join(late.m);
    expect(late.applied).toEqual([[URI, "v2"]]);

    leave();
    expect(hub.size).toBe(0);
    await expect(hub.publish(URI, "v3")).resolves.toBe(0);
    expect(late.applied).toEqual([[URI, "v2"]]);
  });
});

describe("setResourceText", () => {
  it("returns false for a URI that is not registered", () => {
    expect(setResourceText(new Map(), URI, "v1")).toBe(false);
  });
});
