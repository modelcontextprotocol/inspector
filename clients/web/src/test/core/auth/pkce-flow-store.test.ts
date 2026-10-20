import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createWebStoragePkceFlowStore,
  PKCE_FLOW_STORAGE_KEY_PREFIX,
  type PkceFlowStorageArea,
} from "@inspector/core/auth/pkce-flow-store.js";

const SERVER = "https://mcp.example.com";
const FLOW = "f".repeat(64);

function makeArea(): PkceFlowStorageArea & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("createWebStoragePkceFlowStore (#2726)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a verifier under a per-flow key", async () => {
    const area = makeArea();
    const store = createWebStoragePkceFlowStore(() => area);

    await store.saveCodeVerifier(FLOW, SERVER, "cv");

    expect([...area.items.keys()]).toEqual([
      `${PKCE_FLOW_STORAGE_KEY_PREFIX}${FLOW}`,
    ]);
    expect(await store.getCodeVerifier(FLOW, SERVER)).toBe("cv");
  });

  it("keeps flows for the same server apart", async () => {
    const otherTab = createWebStoragePkceFlowStore(() => makeArea());
    const area = makeArea();
    const shared = createWebStoragePkceFlowStore(() => area);
    const other = "e".repeat(64);

    await shared.saveCodeVerifier(FLOW, SERVER, "cv-1");
    await shared.saveCodeVerifier(other, SERVER, "cv-2");

    expect(await shared.getCodeVerifier(FLOW, SERVER)).toBe("cv-1");
    expect(await shared.getCodeVerifier(other, SERVER)).toBe("cv-2");
    // A separate storage area (another tab) sees neither.
    expect(await otherTab.getCodeVerifier(FLOW, SERVER)).toBeUndefined();
  });

  it("does not answer for a different server than the flow was started for", async () => {
    const store = createWebStoragePkceFlowStore(() => makeArea());
    await store.saveCodeVerifier(FLOW, SERVER, "cv");

    expect(
      await store.getCodeVerifier(FLOW, "https://other.example.com"),
    ).toBeUndefined();
  });

  it("clears a flow's verifier", async () => {
    const area = makeArea();
    const store = createWebStoragePkceFlowStore(() => area);
    await store.saveCodeVerifier(FLOW, SERVER, "cv");

    await store.clearCodeVerifier(FLOW);

    expect(area.items.size).toBe(0);
    expect(await store.getCodeVerifier(FLOW, SERVER)).toBeUndefined();
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "42"],
    ["null", "null"],
    ["missing the verifier", JSON.stringify({ serverUrl: SERVER })],
    [
      "a non-string verifier",
      JSON.stringify({ serverUrl: SERVER, codeVerifier: 1 }),
    ],
  ])("treats a corrupt entry (%s) as absent", async (_label, raw) => {
    const area = makeArea();
    area.items.set(`${PKCE_FLOW_STORAGE_KEY_PREFIX}${FLOW}`, raw);
    const store = createWebStoragePkceFlowStore(() => area);

    expect(await store.getCodeVerifier(FLOW, SERVER)).toBeUndefined();
  });

  it("defaults to sessionStorage", async () => {
    const area = makeArea();
    vi.stubGlobal("sessionStorage", area);
    const store = createWebStoragePkceFlowStore();

    await store.saveCodeVerifier(FLOW, SERVER, "cv");

    expect(area.items.has(`${PKCE_FLOW_STORAGE_KEY_PREFIX}${FLOW}`)).toBe(true);
  });
});
