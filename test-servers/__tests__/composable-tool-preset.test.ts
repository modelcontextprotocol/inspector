/**
 * composable_tool preset: JSON Schema validation + echo (text / structuredContent)
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolvePreset } from "../src/preset-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("composable_tool preset", () => {
  it("rejects invalid params at resolve time", () => {
    expect(() =>
      resolvePreset("tool", "composable_tool", {
        name: "",
        inputSchema: { type: "object" },
      }),
    ).toThrow("name");

    expect(() =>
      resolvePreset("tool", "composable_tool", {
        name: "x",
        inputSchema: "not-an-object",
      }),
    ).toThrow("inputSchema");
  });

  it("runs via stdio: text echo and structured echo, and rejects bad args", async () => {
    const scriptPath = path.join(__dirname, "../build/server-composable.js");
    const configPath = path.join(__dirname, "../configs/composable-tool.json");
    const transport = new StdioClientTransport({
      command: "node",
      args: [scriptPath, "--config", configPath],
      cwd: path.join(__dirname, ".."),
    });

    const client = new Client(
      { name: "composable-tool-test-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "echo_json_schema")).toBe(true);
      expect(tools.some((t) => t.name === "echo_structured")).toBe(true);

      const textResult = await client.callTool({
        name: "echo_json_schema",
        arguments: { msg: "hi" },
      });
      expect(textResult.isError).not.toBe(true);
      const textPart = (
        textResult.content as { type: string; text?: string }[]
      ).find((c) => c.type === "text");
      expect(textPart?.text).toBe(JSON.stringify({ msg: "hi" }));

      const bad = await client.callTool({
        name: "echo_json_schema",
        arguments: {},
      });
      expect(bad.isError).toBe(true);

      const structResult = await client.callTool({
        name: "echo_structured",
        arguments: { n: 42 },
      });
      expect(structResult.isError).not.toBe(true);
      expect(structResult.structuredContent).toEqual({ n: 42 });
    } finally {
      await transport.close();
    }
  });
});
