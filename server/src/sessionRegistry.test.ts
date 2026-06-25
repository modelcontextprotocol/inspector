import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  chainOnClose,
  removeSession,
  sendToClientSafe,
  type SessionMaps,
} from "./sessionRegistry.js";

describe("sessionRegistry", () => {
  it("removeSession clears all session maps", () => {
    const maps: SessionMaps = {
      webAppTransports: new Map([["s1", {} as Transport]]),
      serverTransports: new Map([["s1", {} as Transport]]),
      sessionHeaderHolders: new Map([["s1", { headers: {} }]]),
    };

    removeSession(maps, "s1");

    assert.equal(maps.webAppTransports.size, 0);
    assert.equal(maps.serverTransports.size, 0);
    assert.equal(maps.sessionHeaderHolders.size, 0);
  });

  it("sendToClientSafe ignores Not connected errors", async () => {
    const transport = {
      send: async () => {
        throw new Error("Not connected");
      },
    } as unknown as Transport;

    sendToClientSafe(transport, {
      jsonrpc: "2.0",
      method: "notifications/test",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("chainOnClose runs chained handlers in order", () => {
    const calls: string[] = [];
    const transport = {
      onclose: () => {
        calls.push("previous");
      },
    } as Transport;

    chainOnClose(transport, () => {
      calls.push("new");
    });
    transport.onclose?.();

    assert.deepEqual(calls, ["new", "previous"]);
  });
});
