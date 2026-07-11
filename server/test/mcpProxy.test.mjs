import assert from "node:assert/strict";
import test from "node:test";

import mcpProxy from "../build/mcpProxy.js";

class TestTransport {
  closeCalls = 0;

  async start() {}

  async send() {}

  async close() {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

test("client disconnect cleans up once and closes the server transport", async () => {
  const clientTransport = new TestTransport();
  const serverTransport = new TestTransport();
  let cleanupCalls = 0;

  mcpProxy({
    transportToClient: clientTransport,
    transportToServer: serverTransport,
    onCleanup: () => {
      cleanupCalls += 1;
    },
  });

  clientTransport.onclose();
  await Promise.resolve();

  assert.equal(cleanupCalls, 1);
  assert.equal(serverTransport.closeCalls, 1);
});

test("server disconnect cleans up once and closes the client transport", async () => {
  const clientTransport = new TestTransport();
  const serverTransport = new TestTransport();
  let cleanupCalls = 0;

  mcpProxy({
    transportToClient: clientTransport,
    transportToServer: serverTransport,
    onCleanup: () => {
      cleanupCalls += 1;
    },
  });

  serverTransport.onclose();
  await Promise.resolve();

  assert.equal(cleanupCalls, 1);
  assert.equal(clientTransport.closeCalls, 1);
});
