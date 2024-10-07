import { JSONRPCMessage } from "../types.js";
import { StdioClientTransport, StdioServerParameters } from "./stdio.js";

const serverParameters: StdioServerParameters = {
  command: "/usr/bin/tee",
};

test("should start then close cleanly", async () => {
  const client = new StdioClientTransport();
  client.onerror = (error) => {
    throw error;
  };

  let didClose = false;
  client.onclose = () => {
    didClose = true;
  };

  await client.spawn(serverParameters);
  expect(didClose).toBeFalsy();
  await client.close();
  expect(didClose).toBeTruthy();
});

test("should read messages", async () => {
  const client = new StdioClientTransport();
  client.onerror = (error) => {
    throw error;
  };

  const messages: JSONRPCMessage[] = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
  ];

  const readMessages: JSONRPCMessage[] = [];
  const finished = new Promise<void>((resolve) => {
    client.onmessage = (message) => {
      readMessages.push(message);

      if (JSON.stringify(message) === JSON.stringify(messages[1])) {
        resolve();
      }
    };
  });

  await client.spawn(serverParameters);
  await client.send(messages[0]);
  await client.send(messages[1]);
  await finished;
  expect(readMessages).toEqual(messages);

  await client.close();
});
