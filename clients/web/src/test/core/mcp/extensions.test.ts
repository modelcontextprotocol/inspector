import { describe, it, expect } from "vitest";
import {
  ADVERTISABLE_EXTENSIONS,
  EMA_EXTENSION_KEY,
  UI_EXTENSION_KEY,
  MCP_APP_MIME_TYPE,
  buildClientExtensions,
} from "@inspector/core/mcp/extensions.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/mcp/modernTaskSchemas.js";
import { SKILLS_EXTENSION_KEY } from "@inspector/core/mcp/skillsSchemas.js";

// The `ui` extension carries a non-empty advertisement value; the others are
// declared with `{}`. Spelled out here so the map assertions stay readable.
const UI_ADVERTISEMENT = { mimeTypes: [MCP_APP_MIME_TYPE] };

// Every registry entry switched off, so a test can re-enable exactly the ones
// it is about without restating the whole registry.
const ALL_REGISTRY_OFF = {
  [TASKS_EXTENSION_KEY]: false,
  [UI_EXTENSION_KEY]: false,
  [SKILLS_EXTENSION_KEY]: false,
};

describe("extensions (#1738, #1740, #2373, #2403)", () => {
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
      // ...but only for a client that can render Apps (#2403).
      expect(ui?.requiresAppRenderer).toBe(true);
      expect(ui?.advertisement).toEqual(UI_ADVERTISEMENT);
      // The exact value is drift-guarded against ext-apps' real RESOURCE_MIME_TYPE
      // in src/test/integration/mcp/extensions-mimetype.test.ts (node env, where
      // the ext-apps import resolves). A literal check here would only compare
      // the constant to a copy of itself.
      expect(typeof MCP_APP_MIME_TYPE).toBe("string");
    });

    it("lists the Skills extension, advertised by default with no settings (#2373)", () => {
      // SEP-2133 negotiates an extension from both sides, so a server may
      // refuse `skills/*` to a client that did not declare it. The Inspector
      // calls those methods, so it must declare the extension by default.
      const skills = ADVERTISABLE_EXTENSIONS.find(
        (e) => e.key === SKILLS_EXTENSION_KEY,
      );
      expect(skills).toBeDefined();
      expect(skills?.defaultAdvertised).toBe(true);
      expect(skills?.advertisement).toBeUndefined();
      expect(skills?.label).toContain("Skills");
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
    it("advertises registry defaults with no overrides (tasks + ui + skills)", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
        [SKILLS_EXTENSION_KEY]: {},
      });
    });

    it("stamps the UI extension's mimeTypes advertisement value (#1740)", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      expect(map[UI_EXTENSION_KEY]).toEqual(UI_ADVERTISEMENT);
    });

    it("does not alias the registry advertisement across builds (#1740)", () => {
      // Mutating a stamped advertisement must not corrupt the registry for the
      // next connection — the builder clones it.
      const first = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      (first[UI_EXTENSION_KEY] as { mimeTypes: string[] }).mimeTypes.push(
        "text/evil",
      );
      const second = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      expect(second[UI_EXTENSION_KEY]).toEqual(UI_ADVERTISEMENT);
    });

    it("adds EMA when enterpriseManaged, alongside the registry defaults", () => {
      const map = buildClientExtensions({
        enterpriseManaged: true,
        rendersApps: true,
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
        [SKILLS_EXTENSION_KEY]: {},
        [EMA_EXTENSION_KEY]: {},
      });
    });

    it("omits EMA when not enterpriseManaged", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      expect(map).not.toHaveProperty(EMA_EXTENSION_KEY);
    });

    it("honors a user override that disables a default-on extension", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: ALL_REGISTRY_OFF,
      });
      expect(map).toEqual({});
    });

    it("can disable just the UI extension, keeping the others (#1740)", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: { [UI_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [SKILLS_EXTENSION_KEY]: {},
      });
    });

    it("can disable just the Skills extension, keeping the others (#2373)", () => {
      // The Server Settings toggle for skills is how a user checks that a
      // server refuses `skills/*` to a client that did not declare it.
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: { [SKILLS_EXTENSION_KEY]: false },
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
      });
    });

    it("honors a user override that keeps a default-on extension enabled", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: { ...ALL_REGISTRY_OFF, [TASKS_EXTENSION_KEY]: true },
      });
      expect(map).toEqual({ [TASKS_EXTENSION_KEY]: {} });
    });

    it("does not let an override advertise EMA (auth-mode only)", () => {
      // EMA is not a free toggle: it follows the auth mode, so an override for
      // its key must not be able to advertise it. Locks in intent and guards
      // against someone mistakenly adding EMA to ADVERTISABLE_EXTENSIONS.
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: { [EMA_EXTENSION_KEY]: true },
      });
      expect(map).not.toHaveProperty(EMA_EXTENSION_KEY);
    });

    it("ignores override keys that are not in the registry", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        advertised: { "io.example/unknown": true },
      });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [UI_EXTENSION_KEY]: UI_ADVERTISEMENT,
        [SKILLS_EXTENSION_KEY]: {},
      });
    });

    it("layers EMA on even when all registry entries are disabled", () => {
      const map = buildClientExtensions({
        enterpriseManaged: true,
        rendersApps: true,
        advertised: ALL_REGISTRY_OFF,
      });
      expect(map).toEqual({ [EMA_EXTENSION_KEY]: {} });
    });
  });

  describe("app-rendered elicitation opt-in (#1854)", () => {
    it("does not advertise the nested elicitation setting by default", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
      });
      expect(map[UI_EXTENSION_KEY]).toEqual(UI_ADVERTISEMENT);
    });

    it("nests `elicitation` inside the UI extension when opted in", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        appElicitation: true,
      });
      expect(map[UI_EXTENSION_KEY]).toEqual({
        ...UI_ADVERTISEMENT,
        elicitation: {},
      });
      // A nested setting, NOT a second extension — the contract is explicit
      // that no new extension id is introduced.
      expect(Object.keys(map)).toEqual([
        TASKS_EXTENSION_KEY,
        UI_EXTENSION_KEY,
        SKILLS_EXTENSION_KEY,
      ]);
    });

    it("advertises nothing when the UI extension itself is turned off", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        appElicitation: true,
        advertised: { [UI_EXTENSION_KEY]: false },
      });
      expect(map).not.toHaveProperty(UI_EXTENSION_KEY);
    });

    it("does not mutate the shared registry advertisement", () => {
      buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: true,
        appElicitation: true,
      });
      const ui = ADVERTISABLE_EXTENSIONS.find(
        (e) => e.key === UI_EXTENSION_KEY,
      );
      expect(ui?.advertisement).toEqual(UI_ADVERTISEMENT);
    });
  });

  describe("clients that cannot render Apps (#2403)", () => {
    // The CLI and TUI share InspectorClient but have no App renderer, so they
    // must not tell a server they support Apps unless explicitly asked to.
    it("omits the UI extension by default when rendersApps is absent", () => {
      const map = buildClientExtensions({ enterpriseManaged: false });
      expect(map).toEqual({
        [TASKS_EXTENSION_KEY]: {},
        [SKILLS_EXTENSION_KEY]: {},
      });
    });

    it("omits the UI extension by default when rendersApps is false", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        rendersApps: false,
      });
      expect(map).not.toHaveProperty(UI_EXTENSION_KEY);
    });

    it("advertises the UI extension on an explicit override", () => {
      const map = buildClientExtensions({
        enterpriseManaged: false,
        advertised: { [UI_EXTENSION_KEY]: true },
      });
      expect(map[UI_EXTENSION_KEY]).toEqual(UI_ADVERTISEMENT);
    });

    it("does not gate extensions that need no renderer", () => {
      const map = buildClientExtensions({ enterpriseManaged: false });
      expect(map).toHaveProperty(TASKS_EXTENSION_KEY);
      expect(map).toHaveProperty(SKILLS_EXTENSION_KEY);
    });
  });
});
