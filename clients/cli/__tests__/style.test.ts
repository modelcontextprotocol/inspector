import { describe, it, expect } from "vitest";
import {
  createStyle,
  resolveAnsiEnabled,
  styleFromOpts,
  PLAIN,
} from "../src/session/style.js";
import {
  formatToolsHuman,
  formatStreamEventHuman,
} from "../src/session/format-human.js";

describe("resolveAnsiEnabled", () => {
  it("is off for --plain, json, NO_COLOR, and non-TTY", () => {
    expect(resolveAnsiEnabled({ plain: true, isTTY: true })).toBe(false);
    expect(resolveAnsiEnabled({ format: "json", isTTY: true })).toBe(false);
    expect(resolveAnsiEnabled({ isTTY: true, noColorEnv: "1" })).toBe(false);
    expect(resolveAnsiEnabled({ isTTY: false, noColorEnv: "" })).toBe(false);
  });

  it("is on for TTY text without plain/NO_COLOR", () => {
    expect(
      resolveAnsiEnabled({ isTTY: true, noColorEnv: "", format: "text" }),
    ).toBe(true);
    expect(styleFromOpts({ isTTY: true, noColorEnv: "" }).ansi).toBe(true);
  });
});

describe("createStyle", () => {
  it("PLAIN is identity; ansi wraps SGR and OSC 8", () => {
    expect(PLAIN.bold("x")).toBe("x");
    expect(PLAIN.link("https://example.com")).toBe("https://example.com");

    const s = createStyle(true);
    expect(s.bold("x")).toContain("\u001b[1m");
    expect(s.dim("x")).toContain("\u001b[2m");
    expect(s.red("x")).toContain("\u001b[31m");
    expect(s.link("https://example.com", "ex")).toContain(
      "\u001b]8;;https://example.com",
    );
    expect(s.link("https://example.com", "ex")).toContain("ex");
    expect(s.link("", "ex")).toBe("ex");
  });

  it("styles human tool lists and log levels when enabled", () => {
    const s = createStyle(true);
    const tools = formatToolsHuman(
      [
        {
          name: "echo",
          description: "hi",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
        },
      ],
      s,
    );
    expect(tools).toContain("\u001b[1m"); // bold name
    expect(tools).toContain("\u001b[36m"); // cyan params
    expect(tools).toContain("\u001b[2m"); // dim description
    expect(tools).toContain("echo");

    const log = formatStreamEventHuman(
      {
        direction: "notification",
        message: { params: { level: "error", data: "boom" } },
      },
      s,
    );
    expect(log).toContain("\u001b[31m");
    expect(log).toContain("boom");
  });
});
