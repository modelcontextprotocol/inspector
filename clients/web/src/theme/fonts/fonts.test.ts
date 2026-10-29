import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The fonts are self-hosted (#2827): these pin that nothing reaches back out
// to a font CDN at runtime, and that every face the stylesheet declares has
// its file beside it (a missing one would only show as a silent fallback).
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "fonts.css"), "utf-8");
const indexHtml = readFileSync(join(here, "../../../index.html"), "utf-8");

function fontUrls(stylesheet: string): string[] {
  return [...stylesheet.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
}

describe("self-hosted fonts", () => {
  it("index.html loads no third-party stylesheet or font", () => {
    expect(indexHtml).not.toMatch(/https?:\/\//);
  });

  it("declares both theme families", () => {
    expect(css).toContain('font-family: "Fredoka"');
    expect(css).toContain('font-family: "Roboto Mono"');
  });

  it("references only local woff2 files that exist", () => {
    const urls = fontUrls(css);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^\.\/[a-z-]+\.woff2$/);
      expect(existsSync(join(here, url))).toBe(true);
    }
  });

  it("ships the full upstream license for each family (#2827)", () => {
    for (const [file, notice] of [
      ["Fredoka-OFL.txt", "The Fredoka Project Authors"],
      ["RobotoMono-OFL.txt", "The Roboto Mono Project Authors"],
    ]) {
      const text = readFileSync(
        join(here, "../../../public/fonts", file),
        "utf-8",
      );
      expect(text).toContain(notice);
      expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });
});
