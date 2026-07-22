import { describe, it, expect } from "vitest";
import {
  ADVERTISABLE_EXTENSIONS,
  EMA_EXTENSION_KEY,
  UI_EXTENSION_KEY,
  MCP_APP_MIME_TYPE,
  buildClientExtensions,
} from "@inspector/core/mcp/extensions.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/mcp/modernTaskSchemas.js";

// The `ui` extension carries a non-empty advertisement value; the others are
// declared with `{}`. Spelled out here so the map assertions stay readable.
const UI_ADVERTISEMENT = { mimeTypes: [MCP_APP_MIME_TYPE] };

describe("extensions (#1738, #1740)", () => {
  describe("ADVERTISABLE_EXTENSIONS registry", () => {
    it("lists the Tasks extension, advertised by default", () => {
      const tasks = ADVERTISABLE_EXTENSIONS.find(
        (e) => e.key === TASKS_EXTENSION_KEY,
      );
      expect(tasks).toBeDefined();
      expect(tasks?.defaultAdvertised).toBe(true);
      expect(tasks?.label).toContain("Tasks");
    });

    it("lists the UI extension advertised by default with the App MIME type (#1740)", () => {
      const ui = ADVERTISABLE_EXTENSIONS.find(
        (e) => e.key === UI_EXTENSION_KEY,
      );
      expect(ui).toBeDefined();
      expect(ui?.defaultAdvertised).toBe(true);
      expect(ui?.advertisement).toEqual(UI_ADVERTISEMENT);
      expect(MCP_APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
    });

    it("does not list EMA (it follows the auth mode, not a toggle)", () => {
      expect(
        ADVERTISABLE_EXTENSIONS.some((e) => e.key === EMA_EXTENSION_KEY),
      ).toBe(false);
    });

    it("has unique keys and non-empty labels", () => {
      const keys = ADVERTISABLE_EXTENSIONS.map((e) => e.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const ext of ADVERTISABLE_EXTENSIONS) {
        expect(ext.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("buildClientExtensions", () => {
    it("advertises registry defaults with no overrides (tasks + ui)", () => {
      const map = buildClientExtensions({ enterpriseManaged: false });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
      });
    });

    it("stamps the UI extension's mimeTypes advertisement value (#1740)", () => {
      const map = buildClientExtensions({ enterpriseManaged: false });
      expect(map[UI_EXTENSION_KEY]).toEqual(UI_ADVERTISEMENT);
    });

    it("adds EMA when enterpriseManaged, alongside the registry defaults", () => {
      const map = buildClientExtensions({ enterpriseManaged: true });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
        [EMA_EXTENSION_KEY]: {},
      });
    });

    it("omits EMA when not enterpriseManaged", () => {
      const map = buildClientExtensions({ enterpriseManaged: false });
      expect(map).not.toHaveProperty(EMA_EXTENSION_KEY);
    });

    it("honors a user override that disables a default-on extension", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { [TASKS_EXTENSION_KEY]: false, [UI_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({});
    });

    it("can disable just the UI extension, keeping Tasks (#1740)", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { [UI_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({ [TASKS_EXTENSION_KEY]: {} });
    });

    it("honors a user override that keeps a default-on extension enabled", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { [TASKS_EXTENSION_KEY]: true, [UI_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({ [TASKS_EXTENSION_KEY]: {} });
    });

    it("does not let an override advertise EMA (auth-mode only)", () => {
      // EMA is not a free toggle: it follows the auth mode, so an override for
      // its key must not be able to advertise it. Locks in intent and guards
      // against someone mistakenly adding EMA to ADVERTISABLE_EXTENSIONS.
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { [EMA_EXTENSION_KEY]: true },
      });
      expect(map).not.toHaveProperty(EMA_EXTENSION_KEY);
    });

    it("ignores override keys that are not in the registry", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { "io.example/unknown": true },
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
      });
    });

    it("layers EMA on even when all registry entries are disabled", () => {
      const map = buildClientExtensions({
        enterpriseManaged: true,
        advertised: { [TASKS_EXTENSION_KEY]: false, [UI_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({ [EMA_EXTENSION_KEY]: {} });
    });
  });
});
