import { StdioClientTransport } from "./stdio.js";
const serverParameters = {
    command: "/usr/bin/tee",
};
test("should start then close cleanly", async () => {
    const client = new StdioClientTransport(serverParameters);
    client.onerror = (error) => {
        throw error;
    };
    let didClose = false;
    client.onclose = () => {
        didClose = true;
    };
    await client.start();
    expect(didClose).toBeFalsy();
    await client.close();
    expect(didClose).toBeTruthy();
});
test("should read messages", async () => {
    const client = new StdioClientTransport(serverParameters);
    client.onerror = (error) => {
        throw error;
    };
    const messages = [
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
    const readMessages = [];
    const finished = new Promise((resolve) => {
        client.onmessage = (message) => {
            readMessages.push(message);
            if (JSON.stringify(message) === JSON.stringify(messages[1])) {
                resolve();
            }
        };
    });
    await client.start();
    await client.send(messages[0]);
    await client.send(messages[1]);
    await finished;
    expect(readMessages).toEqual(messages);
    await client.close();
});
//# sourceMappingURL=stdio.test.js.map