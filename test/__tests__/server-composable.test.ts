/**
 * Integration test: run composable server from demo.json, connect via MCP SDK, verify, shut down
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("server-composable", () => {
  it("should run composable server from demo.json, list tools via MCP client, then shut down", async () => {
    const scriptPath = path.join(__dirname, "../build/server-composable.js");
    const configPath = path.join(__dirname, "../configs/demo.json");
    const transport = new StdioClientTransport({
      command: "node",
      args: [scriptPath, "--config", configPath],
      cwd: path.join(__dirname, ".."),
    });

    const client = new Client(
      { name: "composable-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("echo");

      const result = await client.callTool({
        name: "echo",
        arguments: { message: "hello from test" },
      });
      expect(result.content).toBeDefined();
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(Array.isArray(content)).toBe(true);
      const textContent = content.find((c) => c.type === "text");
      expect(textContent).toBeDefined();
      expect(textContent!.text).toContain("Echo:");
      expect(textContent!.text).toContain("hello from test");
    } finally {
      await transport.close();
    }
  });
});
