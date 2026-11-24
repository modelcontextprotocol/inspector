import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type {
  FetchRequestEntry,
  MessageEntry,
} from "@inspector/core/mcp/types.js";
import {
  EventSubscriptionsState,
  type EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import {
  generateWebhookSecret,
  REDACTED_WEBHOOK_SECRET,
} from "@inspector/core/extension/events/webhookSecret.js";
import type { JsonValue } from "@inspector/core/json/jsonUtils.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  loadConfig,
  resolveConfig,
  EVENTS_CONTROL_TOOL_NAMES,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Webhook subscription management (#3031) end to end against the phase 0
 * fixture over a real Streamable HTTP transport: the fixture's validation
 * (https, private hosts, the secret's shape), its endpoint-verification
 * failures, its TTL grant and clamps, its canned `deliveryStatus` on refresh,
 * `events/unsubscribe`, and the secret staying out of the Protocol and Network
 * records. The fixture never contacts a callback URL; its outcomes are keyed
 * off the URL (see docs/test-servers.md).
 *
 * Every wait is a condition wait bounded inside the integration budget.
 */

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");

/** Inner condition-wait budget; strictly below the test budget. */
const WAIT = { timeout: 10_000, interval: 20 };
const HOOK = "https://hooks.example.com/in";
const MINUTE = 60_000;

describe("Events webhook management over a real transport (#3031)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: EventSubscriptionsState | null = null;

  afterEach(async () => {
    state?.destroy();
    state = null;
    try {
      await client?.disconnect();
    } catch {
      // ignore
    }
    client = null;
    try {
      await server?.stop();
    } catch {
      // ignore
    }
    server = null;
  });

  async function setup(): Promise<{
    c: InspectorClient;
    s: EventSubscriptionsState;
    incident: EventType;
    messages: MessageEntry[];
    fetches: FetchRequestEntry[];
  }> {
    const started = createTestServerHttp({
      ...resolveConfig(loadConfig(MODERN_CONFIG)),
      port: undefined,
    });
    await started.start();
    server = started;
    const c = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    client = c;
    const messages: MessageEntry[] = [];
    const fetches: FetchRequestEntry[] = [];
    c.addEventListener("message", (e) => messages.push(e.detail));
    c.addEventListener("fetchRequest", (e) => fetches.push(e.detail));
    await c.connect();
    expect(c.getProtocolEra()).toBe("modern");
    const s = new EventSubscriptionsState(c, { reconnectJitterMs: 20 });
    state = s;
    const { events } = await c.listAllEvents();
    const incident = events.find((e) => e.name === "incident.created");
    if (!incident) throw new Error("incident.created not listed");
    return { c, s, incident, messages, fetches };
  }

  async function control(
    c: InspectorClient,
    name: string,
    args: Record<string, JsonValue> = {},
  ): Promise<Record<string, unknown>> {
    const tools: Tool[] = (await c.listAllTools()).tools;
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`fixture tool ${name} not listed`);
    const result = await c.callTool(tool, args);
    expect(result.success).toBe(true);
    return (result.result?.structuredContent ?? {}) as Record<string, unknown>;
  }

  async function webhookCount(c: InspectorClient): Promise<number> {
    const raw = await control(c, EVENTS_CONTROL_TOOL_NAMES.stats);
    return raw.webhookSubscriptions as number;
  }

  function sub(s: EventSubscriptionsState, id: string): EventSubscription {
    const found = s.getSubscription(id);
    if (!found) throw new Error(`no subscription ${id}`);
    return found;
  }

  async function settled(
    s: EventSubscriptionsState,
    id: string,
  ): Promise<EventSubscription> {
    await vi.waitFor(
      () => expect(["active", "terminated"]).toContain(sub(s, id).status),
      WAIT,
    );
    return sub(s, id);
  }

  /** Expected grant, from the moment around the subscribe, within a margin. */
  function expectGrant(refreshBefore: string | null | undefined, ms: number) {
    expect(typeof refreshBefore).toBe("string");
    const delta = Date.parse(refreshBefore as string) - Date.now();
    expect(delta).toBeGreaterThan(ms - 5000);
    expect(delta).toBeLessThanOrEqual(ms);
  }

  it("subscribes, refreshes with deliveryStatus, and unsubscribes", async () => {
    const { c, s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      arguments: { severity: "P1" },
      webhook: { url: `${HOOK}/failing` },
    });
    const first = await settled(s, created.id);
    expect(first.status).toBe("active");
    expect(first.webhook?.id).toMatch(/^sub_[0-9a-f]{16}$/);
    // A first subscribe carries no deliveryStatus; the fixture's default
    // grant is an hour.
    expect(first.webhook?.deliveryStatus).toBeUndefined();
    expectGrant(first.webhook?.refreshBefore, 60 * MINUTE);
    expect(first.cursor).not.toBeNull();
    expect(await webhookCount(c)).toBe(1);

    expect(s.refreshWebhook(created.id)).toBe(true);
    await vi.waitFor(
      () => expect(sub(s, created.id).webhook?.refreshes).toBe(2),
      WAIT,
    );
    // The same server-derived id across refreshes, and the canned failing
    // status for a `/failing` path.
    expect(sub(s, created.id).webhook).toMatchObject({
      id: first.webhook?.id,
      deliveryStatus: { active: false, lastError: "http_5xx" },
    });
    expect(sub(s, created.id).webhook?.deliveryStatus?.failedSince).toEqual(
      expect.any(String),
    );
    expect(await webhookCount(c)).toBe(1);

    s.stop(created.id);
    await vi.waitFor(
      () =>
        expect(sub(s, created.id).webhook?.unsubscribe?.status).toBe("done"),
      WAIT,
    );
    expect(await webhookCount(c)).toBe(0);

    // A second unsubscribe finds nothing to tear down.
    await expect(
      c.unsubscribeEvents(incident, {
        arguments: { severity: "P1" },
        delivery: { url: `${HOOK}/failing` },
      }),
    ).rejects.toMatchObject({ code: EVENTS_ERROR_CODES.NotFound });
  });

  it("subscribes and unsubscribes directly through the client", async () => {
    const { c, incident } = await setup();
    const delivery = {
      mode: "webhook" as const,
      url: HOOK,
      secret: generateWebhookSecret(),
    };
    const first = await c.subscribeEvents(incident, { delivery });
    expect(first.deliveryStatus).toBeUndefined();
    // Idempotent: the same key refreshes the same subscription.
    const again = await c.subscribeEvents(incident, {
      delivery,
      cursor: first.cursor,
      maxAgeMs: 1000,
      ttlMs: 2 * MINUTE,
    });
    expect(again.id).toBe(first.id);
    expect(again.deliveryStatus).toMatchObject({ active: true });
    expectGrant(again.refreshBefore, 2 * MINUTE);
    expect(await webhookCount(c)).toBe(1);
    await c.unsubscribeEvents(incident, { delivery: { url: HOOK } });
    expect(await webhookCount(c)).toBe(0);
  });

  it("reports throttling from the refresh's deliveryStatus", async () => {
    const { s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: `${HOOK}/throttled` },
    });
    await settled(s, created.id);
    s.refreshWebhook(created.id);
    await vi.waitFor(
      () => expect(sub(s, created.id).webhook?.refreshes).toBe(2),
      WAIT,
    );
    expect(sub(s, created.id).webhook?.deliveryStatus).toMatchObject({
      active: true,
      throttled: true,
      retryAfterMs: 60_000,
    });
  });

  it.each([
    ["clamps a short suggestion up to the floor", 1000, 1 * MINUTE],
    ["grants a suggestion inside the bounds", 10 * MINUTE, 10 * MINUTE],
    [
      "clamps a long suggestion down to a day",
      7 * 24 * 60 * MINUTE,
      24 * 60 * MINUTE,
    ],
  ])("%s", async (_label, ttlMs, grant) => {
    const { s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: HOOK, ttlMs },
    });
    const done = await settled(s, created.id);
    expectGrant(done.webhook?.refreshBefore, grant);
    expect(done.webhook?.nextRefreshAt).toBeInstanceOf(Date);
  });

  it("grants no expiry only for ttlMs: null, and schedules no refresh", async () => {
    const { s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: HOOK, ttlMs: null },
    });
    const done = await settled(s, created.id);
    expect(done.webhook?.refreshBefore).toBeNull();
    expect(done.webhook?.nextRefreshAt).toBeNull();
  });

  it.each([
    ["challenge_failed", "https://challenge-failed.example.com/hook"],
    ["connection_refused", "https://connection-refused.example.com/hook"],
    ["tls_error", "https://tls-error.example.com/hook"],
  ])("ends on CallbackEndpointError with reason %s", async (reason, url) => {
    const { c, s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url },
    });
    const done = await settled(s, created.id);
    expect(done.status).toBe("terminated");
    expect(done.termination).toMatchObject({
      reason: "rejected",
      canResubscribe: false,
      error: {
        code: EVENTS_ERROR_CODES.CallbackEndpointError,
        data: { reason },
      },
    });
    expect(await webhookCount(c)).toBe(0);
  });

  it("is refused by the server for a private callback host", async () => {
    const { s, incident } = await setup();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: "https://127.0.0.1/hook" },
    });
    const done = await settled(s, created.id);
    expect(done.termination?.error).toMatchObject({
      code: -32602,
      message: expect.stringContaining("globally routable"),
    });
  });

  it("ends on Forbidden (an unauthenticated principal)", async () => {
    const { c, s, incident } = await setup();
    await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
      preset: "error_forbidden",
      method: "events/subscribe",
    });
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: HOOK },
    });
    const done = await settled(s, created.id);
    expect(done.termination).toMatchObject({
      reason: "forbidden",
      error: { code: EVENTS_ERROR_CODES.Forbidden },
    });
  });

  it("sends the secret, and records it masked in the Protocol and Network logs", async () => {
    const { s, incident, messages, fetches } = await setup();
    const secret = generateWebhookSecret();
    const created = s.subscribe(incident, {
      mode: "webhook",
      webhook: { url: HOOK, secret },
    });
    await settled(s, created.id);
    // The server accepted it, so the real value went out on the wire.
    expect(sub(s, created.id).status).toBe("active");

    const subscribeMessage = messages.find(
      (m) =>
        m.direction === "request" &&
        "method" in m.message &&
        m.message.method === "events/subscribe",
    );
    expect(subscribeMessage).toBeDefined();
    expect(JSON.stringify(subscribeMessage)).not.toContain(secret.slice(6));
    expect(JSON.stringify(subscribeMessage)).toContain(REDACTED_WEBHOOK_SECRET);

    await vi.waitFor(
      () =>
        expect(
          fetches.some((f) => f.requestBody?.includes("events/subscribe")),
        ).toBe(true),
      WAIT,
    );
    for (const entry of fetches) {
      expect(JSON.stringify(entry)).not.toContain(secret.slice(6));
    }
    const recorded = fetches.find((f) =>
      f.requestBody?.includes("events/subscribe"),
    );
    expect(recorded?.requestBody).toContain(REDACTED_WEBHOOK_SECRET);
  });
});
