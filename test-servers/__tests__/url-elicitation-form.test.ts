/**
 * Integration test: url_elicitation_form tool
 *
 * Spins up composable server with url_elicitation_form tool, calls it,
 * accepts the URL elicitation, submits the form with test data, and
 * verifies elicitation completion and tool response.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VALUE = "test-input-value-42";

describe("url_elicitation_form", () => {
  it("should call tool, accept elicitation, submit form, and return collected value", async () => {
    const scriptPath = path.join(__dirname, "../build/server-composable.js");
    const configPath = path.join(
      __dirname,
      "../configs/url-elicitation-form.json",
    );
    const transport = new StdioClientTransport({
      command: "node",
      args: [scriptPath, "--config", configPath],
      cwd: path.join(__dirname, ".."),
    });

    let elicitedUrl: string | null = null;
    let elicitedId: string | null = null;
    let completionReceived = false;

    const client = new Client(
      { name: "url-elicitation-form-test-client", version: "1.0.0" },
      {
        capabilities: {
          elicitation: { url: {} },
        },
      },
    );

    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      if (request.params?.mode === "url") {
        elicitedUrl = request.params.url as string;
        elicitedId = request.params.elicitationId as string;
        // Submit form asynchronously after returning accept
        Promise.resolve().then(async () => {
          const formData = new URLSearchParams({
            value: TEST_VALUE,
            elicitation: elicitedId!,
          });
          await fetch(elicitedUrl!, {
            method: "POST",
            body: formData,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
        });
      }
      return { action: "accept" as const };
    });

    client.setNotificationHandler(ElicitationCompleteNotificationSchema, () => {
      completionReceived = true;
    });

    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("url_elicitation_form");

      const result = await client.callTool({
        name: "url_elicitation_form",
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(Array.isArray(content)).toBe(true);
      const textContent = content.find((c) => c.type === "text");
      expect(textContent).toBeDefined();
      expect(textContent!.text).toContain("Collected value:");
      expect(textContent!.text).toContain(TEST_VALUE);

      expect(elicitedUrl).toBeTruthy();
      expect(elicitedId).toBeTruthy();
      expect(completionReceived).toBe(true);
    } finally {
      await transport.close();
    }
  });
});
