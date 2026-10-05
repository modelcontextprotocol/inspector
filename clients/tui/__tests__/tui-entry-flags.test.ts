import { describe, it, expect, vi } from "vitest";
import type { ServerLoadOptions } from "@inspector/core/mcp/node/servers.js";

/**
 * `runTui`'s Commander registration and the forwarding of parsed flags into
 * the shared server loader (#2420). `tui.tsx` sits outside the TUI coverage
 * `include` (`src/**`), and `tui-servers.test.ts` calls the loader directly,
 * so without this a misspelt option or a dropped forwarding field would pass
 * every other test.
 *
 * The loader is mocked to throw a sentinel carrying the options it received,
 * which stops `runTui` before it touches stdout or renders Ink.
 */
class Captured extends Error {
  constructor(readonly options: ServerLoadOptions) {
    super("captured");
  }
}

vi.mock("../src/tui-servers.js", () => ({
  loadTuiServers: (options: ServerLoadOptions) => {
    throw new Captured(options);
  },
}));

async function loaderOptionsFor(argv: string[]): Promise<ServerLoadOptions> {
  const { runTui } = await import("../tui.js");
  try {
    await runTui(["node", "mcp-inspector-tui", ...argv]);
  } catch (err) {
    if (err instanceof Captured) return err.options;
    throw err;
  }
  throw new Error("runTui returned without calling the server loader");
}

describe("runTui --skill-catalog-max-* forwarding (#2420)", () => {
  it("forwards both budget flags, parsed as numbers, to the server loader", async () => {
    const options = await loaderOptionsFor([
      "--server-url",
      "http://127.0.0.1:1/mcp",
      "--transport",
      "http",
      "--skill-catalog-max-skills",
      "3",
      "--skill-catalog-max-bytes",
      "4096",
    ]);
    expect(options.skillCatalogMaxSkills).toBe(3);
    expect(options.skillCatalogMaxBytes).toBe(4096);
  });

  it("leaves both unset when the flags are absent", async () => {
    const options = await loaderOptionsFor([
      "--server-url",
      "http://127.0.0.1:1/mcp",
      "--transport",
      "http",
    ]);
    expect(options.skillCatalogMaxSkills).toBeUndefined();
    expect(options.skillCatalogMaxBytes).toBeUndefined();
  });
});
