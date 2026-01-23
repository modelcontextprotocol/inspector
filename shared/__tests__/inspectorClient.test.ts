import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InspectorClient,
  SamplingCreateMessage,
  ElicitationCreateMessage,
} from "../mcp/inspectorClient.js";
import { getTestMcpServerCommand } from "../test/test-server-stdio.js";
import {
  createTestServerHttp,
  type TestServerHttp,
} from "../test/test-server-http.js";
import {
  createEchoTool,
  createTestServerInfo,
  createFileResourceTemplate,
  createCollectSampleTool,
  createCollectElicitationTool,
  createSendNotificationTool,
  createListRootsTool,
  createArgsPrompt,
} from "../test/test-server-fixtures.js";
import type { MessageEntry } from "../mcp/types.js";
import type {
  CreateMessageResult,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";

describe("InspectorClient", () => {
  let client: InspectorClient;
  let server: TestServerHttp | null;
  let serverCommand: { command: string; args: string[] };

  beforeEach(() => {
    serverCommand = getTestMcpServerCommand();
    server = null;
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null as any;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore server stop errors
      }
      server = null;
    }
  });

  describe("Connection Management", () => {
    it("should create client with stdio transport", () => {
      client = new InspectorClient({
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      });

      expect(client.getStatus()).toBe("disconnected");
      expect(client.getServerType()).toBe("stdio");
    });

    it("should connect to server", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      expect(client.getStatus()).toBe("connected");
    });

    it("should disconnect from server", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      expect(client.getStatus()).toBe("connected");

      await client.disconnect();
      expect(client.getStatus()).toBe("disconnected");
    });

    it("should clear server state on disconnect", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();
      expect(client.getTools().length).toBeGreaterThan(0);

      await client.disconnect();
      expect(client.getTools().length).toBe(0);
      expect(client.getResources().length).toBe(0);
      expect(client.getPrompts().length).toBe(0);
    });

    it("should clear messages on connect", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      // Make a request to generate messages
      await client.listTools();
      const firstConnectMessages = client.getMessages();
      expect(firstConnectMessages.length).toBeGreaterThan(0);

      // Disconnect and reconnect
      await client.disconnect();
      await client.connect();
      // After reconnect, messages should be cleared, but connect() itself creates new messages (initialize)
      // So we should have messages from the new connection, but not from the old one
      const secondConnectMessages = client.getMessages();
      // The new connection should have at least the initialize message
      expect(secondConnectMessages.length).toBeGreaterThan(0);
      // But the first message should be from the new connection (check timestamp)
      if (firstConnectMessages.length > 0 && secondConnectMessages.length > 0) {
        const lastFirstMessage =
          firstConnectMessages[firstConnectMessages.length - 1];
        const firstSecondMessage = secondConnectMessages[0];
        if (lastFirstMessage && firstSecondMessage) {
          expect(firstSecondMessage.timestamp.getTime()).toBeGreaterThanOrEqual(
            lastFirstMessage.timestamp.getTime(),
          );
        }
      }
    });
  });

  describe("Message Tracking", () => {
    it("should track requests", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listTools();

      const messages = client.getMessages();
      expect(messages.length).toBeGreaterThan(0);
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request) {
        expect("method" in request.message).toBe(true);
      }
    });

    it("should track responses", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listTools();

      const messages = client.getMessages();
      const request = messages.find((m) => m.direction === "request");
      expect(request).toBeDefined();
      if (request && "response" in request) {
        expect(request.response).toBeDefined();
        expect(request.duration).toBeDefined();
      }
    });

    it("should respect maxMessages limit", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          maxMessages: 5,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Make multiple requests to exceed the limit
      for (let i = 0; i < 10; i++) {
        await client.listTools();
      }

      expect(client.getMessages().length).toBeLessThanOrEqual(5);
    });

    it("should emit message events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const messageEvents: MessageEntry[] = [];
      client.addEventListener("message", (event) => {
        const customEvent = event as CustomEvent<MessageEntry>;
        messageEvents.push(customEvent.detail);
      });

      await client.connect();
      await client.listTools();

      expect(messageEvents.length).toBeGreaterThan(0);
    });

    it("should emit messagesChange events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let changeCount = 0;
      client.addEventListener("messagesChange", () => {
        changeCount++;
      });

      await client.connect();
      await client.listTools();

      expect(changeCount).toBeGreaterThan(0);
    });
  });

  describe("Fetch Request Tracking", () => {
    it("should track HTTP requests for SSE transport", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/sse");
        expect(request.method).toBe("GET");
      }
    });

    it("should track HTTP requests for streamable-http transport", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      const request = fetchRequests[0];
      expect(request).toBeDefined();
      if (request) {
        expect(request.url).toContain("/mcp");
        expect(request.method).toBe("POST");
      }
    });

    it("should track request and response details", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();
      await client.listTools();

      const fetchRequests = client.getFetchRequests();
      expect(fetchRequests.length).toBeGreaterThan(0);
      // Find a request that has response details (not just the initial connection)
      const request = fetchRequests.find((r) => r.responseStatus !== undefined);
      expect(request).toBeDefined();
      if (request) {
        expect(request.requestHeaders).toBeDefined();
        expect(request.responseStatus).toBeDefined();
        expect(request.responseHeaders).toBeDefined();
        expect(request.duration).toBeDefined();
      }
    });

    it("should respect maxFetchRequests limit", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          maxFetchRequests: 3,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Make multiple requests to exceed the limit
      for (let i = 0; i < 10; i++) {
        await client.listTools();
      }

      expect(client.getFetchRequests().length).toBeLessThanOrEqual(3);
    });

    it("should emit fetchRequest events", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const fetchRequestEvents: any[] = [];
      client.addEventListener("fetchRequest", (event) => {
        const customEvent = event as CustomEvent<any>;
        fetchRequestEvents.push(customEvent.detail);
      });

      await client.connect();
      await client.listTools();

      expect(fetchRequestEvents.length).toBeGreaterThan(0);
    });

    it("should emit fetchRequestsChange events", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      await server.start();
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let changeFired = false;
      client.addEventListener("fetchRequestsChange", () => {
        changeFired = true;
      });

      await client.connect();
      await client.listTools();

      expect(changeFired).toBe(true);
    });
  });

  describe("Server Data Management", () => {
    it("should auto-fetch server contents when enabled", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      expect(client.getTools().length).toBeGreaterThan(0);
      expect(client.getCapabilities()).toBeDefined();
      expect(client.getServerInfo()).toBeDefined();
    });

    it("should not auto-fetch server contents when disabled", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      expect(client.getTools().length).toBe(0);
    });

    it("should emit toolsChange event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      const toolsEvents: any[][] = [];
      client.addEventListener("toolsChange", (event) => {
        const customEvent = event as CustomEvent<any[]>;
        toolsEvents.push(customEvent.detail);
      });

      await client.connect();

      expect(toolsEvents.length).toBeGreaterThan(0);
      expect(toolsEvents[0]?.length).toBeGreaterThan(0);
    });
  });

  describe("Tool Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list tools", async () => {
      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should call tool with string arguments", async () => {
      const result = await client.callTool("echo", {
        message: "hello world",
      });

      expect(result).toHaveProperty("result");
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toHaveProperty("type", "text");
      expect(content[0].text).toContain("hello world");
    });

    it("should call tool with number arguments", async () => {
      const result = await client.callTool("get-sum", {
        a: 42,
        b: 58,
      });
      expect(result.success).toBe(true);

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      const resultData = JSON.parse(content[0].text);
      expect(resultData.result).toBe(100);
    });

    it("should call tool with boolean arguments", async () => {
      const result = await client.callTool("get-annotated-message", {
        messageType: "success",
        includeImage: true,
      });

      expect(result.result).toHaveProperty("content");
      const content = result.result!.content as any[];
      expect(content.length).toBeGreaterThan(1);
      const hasImage = content.some((item: any) => item.type === "image");
      expect(hasImage).toBe(true);
    });

    it("should handle tool not found", async () => {
      const result = await client.callTool("nonexistent-tool", {});
      // When tool is not found, the SDK returns an error response, not an exception
      expect(result.success).toBe(true); // SDK returns error in result, not as exception
      expect(result.result).toHaveProperty("isError", true);
      expect(result.result).toBeDefined();
      if (result.result) {
        expect(result.result).toHaveProperty("content");
        const content = result.result.content as any[];
        expect(content[0]).toHaveProperty("text");
        expect(content[0].text).toContain("not found");
      }
    });
  });

  describe("Resource Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list resources", async () => {
      const resources = await client.listResources();
      expect(Array.isArray(resources)).toBe(true);
    });

    it("should read resource", async () => {
      // First get list of resources
      const resources = await client.listResources();
      if (resources.length > 0) {
        const uri = resources[0]!.uri;
        const readResult = await client.readResource(uri);
        expect(readResult).toHaveProperty("result");
        expect(readResult.result).toHaveProperty("contents");
      }
    });
  });

  describe("Resource Template Methods", () => {
    beforeEach(async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();
    });

    it("should list resource templates", async () => {
      const resourceTemplates = await client.listResourceTemplates();
      expect(Array.isArray(resourceTemplates)).toBe(true);
      expect(resourceTemplates.length).toBeGreaterThan(0);

      const templates = resourceTemplates;
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();
      expect(fileTemplate?.uriTemplate).toBe("file:///{path}");
    });

    it("should read resource from template", async () => {
      // First get the template
      const templates = await client.listResourceTemplates();
      const fileTemplate = templates.find((t) => t.name === "file");
      expect(fileTemplate).toBeDefined();

      // Use a URI that matches the template pattern file:///{path}
      // The path variable will be "test.txt"
      const expandedUri = "file:///test.txt";

      // Read the resource using the expanded URI
      const readResult = await client.readResource(expandedUri);
      expect(readResult).toHaveProperty("result");
      expect(readResult.result).toHaveProperty("contents");
      const contents = readResult.result.contents;
      expect(Array.isArray(contents)).toBe(true);
      expect(contents.length).toBeGreaterThan(0);

      const content = contents[0];
      expect(content).toHaveProperty("uri");
      if (content && "text" in content) {
        expect(content.text).toContain("Mock file content for: test.txt");
      }
    });

    it("should include resources from template list callback in listResources", async () => {
      // Create a server with a resource template that has a list callback
      const listCallback = async () => {
        return ["file:///file1.txt", "file:///file2.txt", "file:///file3.txt"];
      };

      await client.disconnect();
      if (server) {
        await server.stop();
      }

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [
          createFileResourceTemplate(undefined, listCallback),
        ],
      });
      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          clientIdentity: { name: "test", version: "1.0.0" },
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Call listResources - this should include resources from the template's list callback
      const resources = await client.listResources();
      expect(Array.isArray(resources)).toBe(true);

      // Verify that the resources from the list callback are included
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("file:///file1.txt");
      expect(uris).toContain("file:///file2.txt");
      expect(uris).toContain("file:///file3.txt");
    });
  });

  describe("Prompt Methods", () => {
    beforeEach(async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();
    });

    it("should list prompts", async () => {
      const prompts = await client.listPrompts();
      expect(Array.isArray(prompts)).toBe(true);
    });
  });

  describe("Logging", () => {
    it("should set logging level when server supports it", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
          initialLoggingLevel: "debug",
        },
      );

      await client.connect();

      // If server supports logging, the level should be set
      // We can't directly verify this, but it shouldn't throw
      const capabilities = client.getCapabilities();
      if (capabilities?.logging) {
        await client.setLoggingLevel("info");
      }
    });

    it("should track stderr logs for stdio transport", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          pipeStderr: true,
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Stderr logs may or may not be present depending on server behavior
      const logs = client.getStderrLogs();
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("Events", () => {
    it("should emit statusChange events", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      const statuses: string[] = [];
      client.addEventListener("statusChange", (event) => {
        const customEvent = event as CustomEvent<string>;
        statuses.push(customEvent.detail);
      });

      await client.connect();
      await client.disconnect();

      expect(statuses).toContain("connecting");
      expect(statuses).toContain("connected");
      expect(statuses).toContain("disconnected");
    });

    it("should emit connect event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let connectFired = false;
      client.addEventListener("connect", () => {
        connectFired = true;
      });

      await client.connect();
      expect(connectFired).toBe(true);
    });

    it("should emit disconnect event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      let disconnectFired = false;
      client.addEventListener("disconnect", () => {
        disconnectFired = true;
      });

      await client.connect();
      await client.disconnect();
      expect(disconnectFired).toBe(true);
    });
  });

  describe("Sampling Requests", () => {
    it("should handle sampling requests from server and respond", async () => {
      // Create a test server with the collectSample tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createCollectSampleTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with sampling enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          sample: true, // Enable sampling capability
        },
      );

      await client.connect();

      // Set up Promise to wait for sampling request event
      const samplingRequestPromise = new Promise<SamplingCreateMessage>(
        (resolve) => {
          client.addEventListener(
            "newPendingSample",
            ((event: CustomEvent) => {
              resolve(event.detail as SamplingCreateMessage);
            }) as EventListener,
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until sampling is responded to)
      const toolResultPromise = client.callTool("collectSample", {
        text: "Hello, world!",
      });

      // Wait for the sampling request to arrive via event
      const pendingSample = await samplingRequestPromise;

      // Verify we received a sampling request
      expect(pendingSample.request.method).toBe("sampling/createMessage");
      const messages = pendingSample.request.params.messages;
      expect(messages.length).toBeGreaterThan(0);
      const firstMessage = messages[0];
      expect(firstMessage).toBeDefined();
      if (
        firstMessage &&
        firstMessage.content &&
        typeof firstMessage.content === "object" &&
        "text" in firstMessage.content
      ) {
        expect((firstMessage.content as { text: string }).text).toBe(
          "Hello, world!",
        );
      }

      // Respond to the sampling request
      const samplingResponse: CreateMessageResult = {
        model: "test-model",
        role: "assistant",
        stopReason: "endTurn",
        content: {
          type: "text",
          text: "This is a test response",
        },
      };

      await pendingSample.respond(samplingResponse);

      // Now await the tool result (it should complete now that we've responded)
      const toolResult = await toolResultPromise;

      // Verify the tool result contains the sampling response
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Sampling response:");
        expect(toolMessage.text).toContain("test-model");
        expect(toolMessage.text).toContain("This is a test response");
      }

      // Verify the pending sample was removed
      const pendingSamples = client.getPendingSamples();
      expect(pendingSamples.length).toBe(0);
    });
  });

  describe("Server-Initiated Notifications", () => {
    it("should receive server-initiated notifications via stdio transport", async () => {
      // Note: stdio test server uses getDefaultServerConfig which now includes sendNotification tool
      // Create client with stdio transport
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from stdio",
        level: "info",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe("Test notification from stdio");
          expect(params.level).toBe("info");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via SSE transport", async () => {
      // Create a test server with the sendNotification tool and logging enabled
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendNotificationTool()],
        serverType: "sse",
        logging: true, // Required for notifications/message
      });

      await server.start();

      // Create client with SSE transport
      client = new InspectorClient(
        {
          type: "sse",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from SSE",
        level: "warning",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe("Test notification from SSE");
          expect(params.level).toBe("warning");
          expect(params.logger).toBe("test-server");
        }
      }
    });

    it("should receive server-initiated notifications via streamable-http transport", async () => {
      // Create a test server with the sendNotification tool and logging enabled
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createSendNotificationTool()],
        serverType: "streamable-http",
        logging: true, // Required for notifications/message
      });

      await server.start();

      // Create client with streamable-http transport
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Set up Promise to wait for notification
      const notificationPromise = new Promise<MessageEntry>((resolve) => {
        client.addEventListener("message", ((event: CustomEvent) => {
          const entry = event.detail as MessageEntry;
          if (entry.direction === "notification") {
            resolve(entry);
          }
        }) as EventListener);
      });

      // Call the sendNotification tool
      await client.callTool("sendNotification", {
        message: "Test notification from streamable-http",
        level: "error",
      });

      // Wait for the notification
      const notificationEntry = await notificationPromise;

      // Validate the notification
      expect(notificationEntry).toBeDefined();
      expect(notificationEntry.direction).toBe("notification");
      if ("method" in notificationEntry.message) {
        expect(notificationEntry.message.method).toBe("notifications/message");
        if ("params" in notificationEntry.message) {
          const params = notificationEntry.message.params as any;
          expect(params.data.message).toBe(
            "Test notification from streamable-http",
          );
          expect(params.level).toBe("error");
          expect(params.logger).toBe("test-server");
        }
      }
    });
  });

  describe("Elicitation Requests", () => {
    it("should handle elicitation requests from server and respond", async () => {
      // Create a test server with the collectElicitation tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createCollectElicitationTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with elicitation enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          elicit: true, // Enable elicitation capability
        },
      );

      await client.connect();

      // Set up Promise to wait for elicitation request event
      const elicitationRequestPromise = new Promise<ElicitationCreateMessage>(
        (resolve) => {
          client.addEventListener(
            "newPendingElicitation",
            ((event: CustomEvent) => {
              resolve(event.detail as ElicitationCreateMessage);
            }) as EventListener,
            { once: true },
          );
        },
      );

      // Start the tool call (don't await yet - it will block until elicitation is responded to)
      const toolResultPromise = client.callTool("collectElicitation", {
        message: "Please provide your name",
        schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Your name",
            },
          },
          required: ["name"],
        },
      });

      // Wait for the elicitation request to arrive via event
      const pendingElicitation = await elicitationRequestPromise;

      // Verify we received an elicitation request
      expect(pendingElicitation.request.method).toBe("elicitation/create");
      expect(pendingElicitation.request.params.message).toBe(
        "Please provide your name",
      );
      if ("requestedSchema" in pendingElicitation.request.params) {
        expect(pendingElicitation.request.params.requestedSchema).toBeDefined();
        expect(pendingElicitation.request.params.requestedSchema.type).toBe(
          "object",
        );
      }

      // Respond to the elicitation request
      const elicitationResponse: ElicitResult = {
        action: "accept",
        content: {
          name: "Test User",
        },
      };

      await pendingElicitation.respond(elicitationResponse);

      // Now await the tool result (it should complete now that we've responded)
      const toolResult = await toolResultPromise;

      // Verify the tool result contains the elicitation response
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Elicitation response:");
        expect(toolMessage.text).toContain("accept");
        expect(toolMessage.text).toContain("Test User");
      }

      // Verify the pending elicitation was removed
      const pendingElicitations = client.getPendingElicitations();
      expect(pendingElicitations.length).toBe(0);
    });
  });

  describe("Roots Support", () => {
    it("should handle roots/list request from server and return roots", async () => {
      // Create a test server with the listRoots tool
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createListRootsTool()],
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with roots enabled
      const initialRoots = [
        { uri: "file:///test1", name: "Test Root 1" },
        { uri: "file:///test2", name: "Test Root 2" },
      ];

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          roots: initialRoots, // Enable roots capability
        },
      );

      await client.connect();

      // Call the listRoots tool - it will call roots/list on the client
      const toolResult = await client.callTool("listRoots", {});

      // Verify the tool result contains the roots
      expect(toolResult).toBeDefined();
      expect(toolResult.success).toBe(true);
      expect(toolResult.result).toBeDefined();
      expect(toolResult.result!.content).toBeDefined();
      expect(Array.isArray(toolResult.result!.content)).toBe(true);
      const toolContent = toolResult.result!.content as any[];
      expect(toolContent.length).toBeGreaterThan(0);
      const toolMessage = toolContent[0];
      expect(toolMessage).toBeDefined();
      expect(toolMessage.type).toBe("text");
      if (toolMessage.type === "text") {
        expect(toolMessage.text).toContain("Roots:");
        expect(toolMessage.text).toContain("file:///test1");
        expect(toolMessage.text).toContain("file:///test2");
      }

      // Verify getRoots() returns the roots
      const roots = client.getRoots();
      expect(roots).toEqual(initialRoots);

      await client.disconnect();
      await server.stop();
    });

    it("should send roots/list_changed notification when roots are updated", async () => {
      // Create a test server - clients can send roots/list_changed notifications to any server
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        serverType: "streamable-http",
      });

      await server.start();

      // Create client with roots enabled
      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
          roots: [], // Enable roots capability with empty array
        },
      );

      await client.connect();

      // Clear any recorded requests from connection
      server.clearRecordings();

      // Update roots
      const newRoots = [
        { uri: "file:///new1", name: "New Root 1" },
        { uri: "file:///new2", name: "New Root 2" },
      ];
      await client.setRoots(newRoots);

      // Wait for the notification to be recorded by the server
      // The notification is sent asynchronously, so we need to wait for it to appear in recordedRequests
      let rootsChangedNotification;
      for (let i = 0; i < 50; i++) {
        const recordedRequests = server.getRecordedRequests();
        rootsChangedNotification = recordedRequests.find(
          (req) => req.method === "notifications/roots/list_changed",
        );
        if (rootsChangedNotification) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Verify the notification was sent to the server
      expect(rootsChangedNotification).toBeDefined();
      if (rootsChangedNotification) {
        expect(rootsChangedNotification.method).toBe(
          "notifications/roots/list_changed",
        );
      }

      // Verify getRoots() returns the new roots
      const roots = client.getRoots();
      expect(roots).toEqual(newRoots);

      // Verify rootsChange event was dispatched
      const rootsChangePromise = new Promise<CustomEvent>((resolve) => {
        client.addEventListener(
          "rootsChange",
          ((event: CustomEvent) => {
            resolve(event);
          }) as EventListener,
          { once: true },
        );
      });

      // Update roots again to trigger event
      await client.setRoots([{ uri: "file:///updated", name: "Updated" }]);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rootsChangeEvent = await rootsChangePromise;
      expect(rootsChangeEvent.detail).toEqual([
        { uri: "file:///updated", name: "Updated" },
      ]);

      // Verify another notification was sent
      const updatedRequests = server.getRecordedRequests();
      const secondNotification = updatedRequests.filter(
        (req) => req.method === "notifications/roots/list_changed",
      );
      expect(secondNotification.length).toBeGreaterThanOrEqual(1);

      await client.disconnect();
      await server.stop();
    });
  });

  describe("Completions", () => {
    it("should get completions for resource template variable", async () => {
      // Create a test server with a resource template that has completion support
      const completionCallback = (argName: string, value: string): string[] => {
        if (argName === "path") {
          const files = ["file1.txt", "file2.txt", "file3.txt"];
          return files.filter((f) => f.startsWith(value));
        }
        return [];
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate(completionCallback)],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "file" variable with partial value "file1"
      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "file1",
      );

      expect(result.values).toContain("file1.txt");
      expect(result.values.length).toBeGreaterThan(0);

      await client.disconnect();
      await server.stop();
    });

    it("should get completions for prompt argument", async () => {
      // Create a test server with a prompt that has completion support
      const cityCompletions = (
        value: string,
        _context?: Record<string, string>,
      ): string[] => {
        const cities = ["New York", "Los Angeles", "Chicago", "Houston"];
        return cities.filter((c) =>
          c.toLowerCase().startsWith(value.toLowerCase()),
        );
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          createArgsPrompt({
            city: cityCompletions,
          }),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "city" argument with partial value "New"
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args-prompt" },
        "city",
        "New",
      );

      expect(result.values).toContain("New York");
      expect(result.values.length).toBeGreaterThan(0);

      await client.disconnect();
      await server.stop();
    });

    it("should return empty array when server does not support completions", async () => {
      // Create a test server without completion support
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [createFileResourceTemplate()], // No completion callback
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions - should return empty array (MethodNotFound handled gracefully)
      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "file",
      );

      expect(result.values).toEqual([]);

      await client.disconnect();
      await server.stop();
    });

    it("should get completions with context (other arguments)", async () => {
      // Create a test server with a prompt that uses context
      const stateCompletions = (
        value: string,
        context?: Record<string, string>,
      ): string[] => {
        const statesByCity: Record<string, string[]> = {
          "New York": ["NY", "New York State"],
          "Los Angeles": ["CA", "California"],
        };

        const city = context?.city;
        if (city && statesByCity[city]) {
          return statesByCity[city].filter((s) =>
            s.toLowerCase().startsWith(value.toLowerCase()),
          );
        }
        return ["NY", "CA", "TX", "FL"].filter((s) =>
          s.toLowerCase().startsWith(value.toLowerCase()),
        );
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          createArgsPrompt({
            state: stateCompletions,
          }),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      // Request completions for "state" with context (city="New York")
      const result = await client.getCompletions(
        { type: "ref/prompt", name: "args-prompt" },
        "state",
        "N",
        { city: "New York" },
      );

      expect(result.values).toContain("NY");
      expect(result.values).toContain("New York State");

      await client.disconnect();
      await server.stop();
    });

    it("should handle async completion callbacks", async () => {
      // Create a test server with async completion callback
      const asyncCompletionCallback = async (
        argName: string,
        value: string,
      ): Promise<string[]> => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        const files = ["async1.txt", "async2.txt", "async3.txt"];
        return files.filter((f) => f.startsWith(value));
      };

      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resourceTemplates: [
          createFileResourceTemplate(asyncCompletionCallback),
        ],
      });

      await server.start();

      client = new InspectorClient(
        {
          type: "streamable-http",
          url: server.url,
        },
        {
          autoFetchServerContents: false,
        },
      );

      await client.connect();

      const result = await client.getCompletions(
        { type: "ref/resource", uri: "file:///{path}" },
        "path",
        "async1",
      );

      expect(result.values).toContain("async1.txt");

      await client.disconnect();
      await server.stop();
    });
  });

  describe("ContentCache integration", () => {
    it("should expose cache property that returns null for all getters initially", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      // Cache should be accessible
      expect(client.cache).toBeDefined();

      // All getters should return null initially
      expect(client.cache.getResource("file:///test.txt")).toBeNull();
      expect(client.cache.getResourceTemplate("file:///{path}")).toBeNull();
      expect(client.cache.getPrompt("testPrompt")).toBeNull();
      expect(client.cache.getToolCallResult("testTool")).toBeNull();

      await client.disconnect();
    });

    it("should clear cache when disconnect() is called", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true,
        },
      );

      await client.connect();

      // Verify cache is accessible
      expect(client.cache).toBeDefined();

      // Populate cache by calling fetch methods
      const resources = await client.listResources();
      let resourceUri: string | undefined;
      if (resources.length > 0 && resources[0]) {
        resourceUri = resources[0].uri;
        await client.readResource(resourceUri);
        expect(client.cache.getResource(resourceUri)).not.toBeNull();
      }

      const tools = await client.listTools();
      let toolName: string | undefined;
      if (tools.length > 0 && tools[0]) {
        toolName = tools[0].name;
        await client.callTool(toolName, {});
        expect(client.cache.getToolCallResult(toolName)).not.toBeNull();
      }

      const prompts = await client.listPrompts();
      let promptName: string | undefined;
      if (prompts.length > 0 && prompts[0]) {
        promptName = prompts[0].name;
        await client.getPrompt(promptName);
        expect(client.cache.getPrompt(promptName)).not.toBeNull();
      }

      // Disconnect should clear cache
      await client.disconnect();

      // After disconnect, cache should be cleared
      if (resourceUri) {
        expect(client.cache.getResource(resourceUri)).toBeNull();
      }
      if (toolName) {
        expect(client.cache.getToolCallResult(toolName)).toBeNull();
      }
      if (promptName) {
        expect(client.cache.getPrompt(promptName)).toBeNull();
      }
    });

    it("should not break existing API", async () => {
      const client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );

      // Verify existing properties and methods still work
      expect(client.getStatus()).toBe("disconnected");
      expect(client.getTools()).toEqual([]);
      expect(client.getResources()).toEqual([]);
      expect(client.getPrompts()).toEqual([]);

      await client.connect();
      expect(client.getStatus()).toBe("connected");

      await client.disconnect();
      expect(client.getStatus()).toBe("disconnected");
    });

    it("should cache resource content and dispatch event when readResource is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";
      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "resourceContentChange",
        ((event: CustomEvent) => {
          eventReceived = true;
          eventDetail = event.detail;
        }) as EventListener,
        { once: true },
      );

      const invocation = await client.readResource(uri);

      // Verify cache
      const cached = client.cache.getResource(uri);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.uri).toBe(uri);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache resource template content and dispatch event when readResourceFromTemplate is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate templates
        },
      );
      await client.connect();

      const template = client.getResourceTemplates()[0];
      if (!template) {
        throw new Error("No resource templates available");
      }

      const params = { path: "test.txt" };
      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "resourceTemplateContentChange",
        ((event: CustomEvent) => {
          eventReceived = true;
          eventDetail = event.detail;
        }) as EventListener,
        { once: true },
      );

      const invocation = await client.readResourceFromTemplate(
        template.uriTemplate,
        params,
      );

      // Verify cache
      const cached = client.cache.getResourceTemplate(template.uriTemplate);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.uriTemplate).toBe(template.uriTemplate);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.params).toEqual(params);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache prompt content and dispatch event when getPrompt is called", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate prompts
        },
      );
      await client.connect();

      const prompt = client.getPrompts()[0];
      if (!prompt) {
        throw new Error("No prompts available");
      }

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "promptContentChange",
        ((event: CustomEvent) => {
          eventReceived = true;
          eventDetail = event.detail;
        }) as EventListener,
        { once: true },
      );

      const invocation = await client.getPrompt(prompt.name);

      // Verify cache
      const cached = client.cache.getPrompt(prompt.name);
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.name).toBe(prompt.name);
      expect(eventDetail.content).toBe(invocation);
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache successful tool call result and dispatch event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: true, // Auto-fetch to populate tools
        },
      );
      await client.connect();

      const tool = client.getTools().find((t) => t.name === "echo");
      if (!tool) {
        throw new Error("Echo tool not available");
      }

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "toolCallResultChange",
        ((event: CustomEvent) => {
          eventReceived = true;
          eventDetail = event.detail;
        }) as EventListener,
        { once: true },
      );

      const invocation = await client.callTool("echo", { message: "test" });

      // Verify cache
      const cached = client.cache.getToolCallResult("echo");
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved
      expect(cached?.success).toBe(true);

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.toolName).toBe("echo");
      expect(eventDetail.success).toBe(true);
      expect(eventDetail.result).not.toBeNull();
      expect(eventDetail.timestamp).toBeInstanceOf(Date);

      await client.disconnect();
    });

    it("should cache failed tool call result and dispatch event", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      let eventReceived = false;
      let eventDetail: any = null;

      client.addEventListener(
        "toolCallResultChange",
        ((event: CustomEvent) => {
          eventReceived = true;
          eventDetail = event.detail;
        }) as EventListener,
        { once: true },
      );

      const invocation = await client.callTool("nonexistent-tool", {});

      // Verify cache
      const cached = client.cache.getToolCallResult("nonexistent-tool");
      expect(cached).not.toBeNull();
      expect(cached).toBe(invocation); // Object identity preserved
      // Note: The tool call might succeed if the server has a catch-all handler
      // So we just verify the cache stores the result correctly
      expect(cached?.toolName).toBe("nonexistent-tool");
      expect(cached?.params).toEqual({});

      // Verify event was dispatched
      expect(eventReceived).toBe(true);
      expect(eventDetail.toolName).toBe("nonexistent-tool");
      expect(eventDetail.params).toEqual({});
      expect(eventDetail.timestamp).toBeInstanceOf(Date);
      // Note: success/error depends on server behavior

      await client.disconnect();
    });

    it("should replace cache entry on subsequent calls", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";

      // First call
      const invocation1 = await client.readResource(uri);
      const cached1 = client.cache.getResource(uri);
      expect(cached1).toBe(invocation1);

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second call should replace cache
      const invocation2 = await client.readResource(uri);
      const cached2 = client.cache.getResource(uri);
      expect(cached2).toBe(invocation2);
      expect(cached2).not.toBe(invocation1); // Different object
      expect(cached2?.timestamp.getTime()).toBeGreaterThan(
        invocation1.timestamp.getTime(),
      );

      await client.disconnect();
    });

    it("should persist cache across multiple calls", async () => {
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          autoFetchServerContents: false,
        },
      );
      await client.connect();

      const uri = "file:///test.txt";

      // First call
      const invocation1 = await client.readResource(uri);
      const cached1 = client.cache.getResource(uri);
      expect(cached1).toBe(invocation1);

      // Second call to same resource
      const invocation2 = await client.readResource(uri);
      const cached2 = client.cache.getResource(uri);
      expect(cached2).toBe(invocation2);

      // Cache should still be accessible
      const cached3 = client.cache.getResource(uri);
      expect(cached3).toBe(invocation2);

      await client.disconnect();
    });
  });
});
