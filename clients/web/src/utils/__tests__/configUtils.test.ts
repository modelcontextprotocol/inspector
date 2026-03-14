import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getMCPServerRequestTimeout,
  resetRequestTimeoutOnProgress,
  getMCPServerRequestMaxTotalTimeout,
  getInspectorApiToken,
  getMCPTaskTtl,
  getInitialTransportType,
  getInitialSseUrl,
  getInitialCommand,
  getInitialArgs,
  getConfigOverridesFromQueryParams,
  initializeInspectorConfig,
  saveInspectorConfig,
} from "../configUtils";
import { DEFAULT_INSPECTOR_CONFIG } from "@/lib/constants";
import type { InspectorConfig } from "@/lib/configurationTypes";

const CONFIG_KEY = "test-inspector-config";

describe("configUtils", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getMCPServerRequestTimeout", () => {
    it("returns timeout value from config", () => {
      const config = { ...DEFAULT_INSPECTOR_CONFIG };
      expect(getMCPServerRequestTimeout(config)).toBe(300000);
    });

    it("returns custom value when config is overridden", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_SERVER_REQUEST_TIMEOUT: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_SERVER_REQUEST_TIMEOUT,
          value: 5000,
        },
      };
      expect(getMCPServerRequestTimeout(config)).toBe(5000);
    });
  });

  describe("resetRequestTimeoutOnProgress", () => {
    it("returns boolean from config", () => {
      expect(resetRequestTimeoutOnProgress(DEFAULT_INSPECTOR_CONFIG)).toBe(
        true,
      );
    });
  });

  describe("getMCPServerRequestMaxTotalTimeout", () => {
    it("returns max total timeout from config", () => {
      expect(getMCPServerRequestMaxTotalTimeout(DEFAULT_INSPECTOR_CONFIG)).toBe(
        60000,
      );
    });
  });

  describe("getInspectorApiToken", () => {
    it("returns undefined when token is empty", () => {
      expect(getInspectorApiToken(DEFAULT_INSPECTOR_CONFIG)).toBeUndefined();
    });

    it("returns token when configured", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_INSPECTOR_API_TOKEN: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_INSPECTOR_API_TOKEN,
          value: "test-token",
        },
      };
      expect(getInspectorApiToken(config)).toBe("test-token");
    });
  });

  describe("getMCPTaskTtl", () => {
    it("returns default task TTL from config", () => {
      expect(getMCPTaskTtl(DEFAULT_INSPECTOR_CONFIG)).toBe(60000);
    });

    it("returns custom value when config is overridden", () => {
      const config: InspectorConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        MCP_TASK_TTL: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_TASK_TTL,
          value: 120000,
        },
      };
      expect(getMCPTaskTtl(config)).toBe(120000);
    });
  });

  describe("getInitialTransportType", () => {
    it("returns transport from URL search param when present", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/?transport=sse" },
        writable: true,
      });
      expect(getInitialTransportType()).toBe("sse");
    });

    it("returns stdio when no param and localStorage empty", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      expect(getInitialTransportType()).toBe("stdio");
    });

    it("returns value from localStorage when no URL param", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      localStorage.setItem("lastTransportType", "streamable-http");
      expect(getInitialTransportType()).toBe("streamable-http");
    });
  });

  describe("getInitialSseUrl", () => {
    it("returns serverUrl from URL param when present", () => {
      Object.defineProperty(window, "location", {
        value: {
          href: "http://localhost/?serverUrl=http%3A%2F%2Fexample.com%2Fsse",
        },
        writable: true,
      });
      expect(getInitialSseUrl()).toBe("http://example.com/sse");
    });

    it("returns default when no param and localStorage empty", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      expect(getInitialSseUrl()).toBe("http://localhost:3001/sse");
    });
  });

  describe("getInitialCommand", () => {
    it("returns command from URL param when present", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/?serverCommand=my-mcp-server" },
        writable: true,
      });
      expect(getInitialCommand()).toBe("my-mcp-server");
    });

    it("returns default when no param and localStorage empty", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      expect(getInitialCommand()).toBe("mcp-server-everything");
    });
  });

  describe("getInitialArgs", () => {
    it("returns args from URL param when present", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/?serverArgs=--verbose" },
        writable: true,
      });
      expect(getInitialArgs()).toBe("--verbose");
    });

    it("returns empty string when no param and localStorage empty", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      expect(getInitialArgs()).toBe("");
    });
  });

  describe("getConfigOverridesFromQueryParams", () => {
    it("returns empty object when no matching params", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      expect(
        getConfigOverridesFromQueryParams(DEFAULT_INSPECTOR_CONFIG),
      ).toEqual({});
    });

    it("coerces number params", () => {
      Object.defineProperty(window, "location", {
        value: {
          href: "http://localhost/?MCP_SERVER_REQUEST_TIMEOUT=10000",
        },
        writable: true,
      });
      const overrides = getConfigOverridesFromQueryParams(
        DEFAULT_INSPECTOR_CONFIG,
      );
      expect(overrides.MCP_SERVER_REQUEST_TIMEOUT?.value).toBe(10000);
    });

    it("coerces boolean params", () => {
      Object.defineProperty(window, "location", {
        value: {
          href: "http://localhost/?MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS=false",
        },
        writable: true,
      });
      const overrides = getConfigOverridesFromQueryParams(
        DEFAULT_INSPECTOR_CONFIG,
      );
      expect(overrides.MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS?.value).toBe(
        false,
      );
    });
  });

  describe("initializeInspectorConfig", () => {
    it("returns default config when storage is empty", () => {
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      const config = initializeInspectorConfig(CONFIG_KEY);
      expect(config.MCP_SERVER_REQUEST_TIMEOUT.value).toBe(300000);
      expect(config.MCP_INSPECTOR_API_TOKEN.value).toBe("");
    });

    it("merges persisted config from localStorage", () => {
      const persisted = {
        MCP_SERVER_REQUEST_TIMEOUT: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_SERVER_REQUEST_TIMEOUT,
          value: 60000,
        },
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(persisted));
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      const config = initializeInspectorConfig(CONFIG_KEY);
      expect(config.MCP_SERVER_REQUEST_TIMEOUT.value).toBe(60000);
    });

    it("strips unrecognized keys from saved config", () => {
      const persisted = {
        MCP_SERVER_REQUEST_TIMEOUT: {
          ...DEFAULT_INSPECTOR_CONFIG.MCP_SERVER_REQUEST_TIMEOUT,
          value: 1000,
        },
        UNKNOWN_KEY: { value: "ignored" },
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(persisted));
      Object.defineProperty(window, "location", {
        value: { href: "http://localhost/" },
        writable: true,
      });
      const config = initializeInspectorConfig(CONFIG_KEY);
      expect(config.MCP_SERVER_REQUEST_TIMEOUT.value).toBe(1000);
      expect(
        (config as Record<string, unknown>)["UNKNOWN_KEY"],
      ).toBeUndefined();
    });
  });

  describe("saveInspectorConfig", () => {
    it("persists non-session config to localStorage", () => {
      const config = { ...DEFAULT_INSPECTOR_CONFIG };
      saveInspectorConfig(CONFIG_KEY, config);
      const saved = localStorage.getItem(CONFIG_KEY);
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.MCP_SERVER_REQUEST_TIMEOUT).toBeDefined();
    });

    it("persists session config to sessionStorage", () => {
      const config = { ...DEFAULT_INSPECTOR_CONFIG };
      saveInspectorConfig(CONFIG_KEY, config);
      const saved = sessionStorage.getItem(`${CONFIG_KEY}_ephemeral`);
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(saved!);
      expect(parsed.MCP_INSPECTOR_API_TOKEN).toBeDefined();
    });
  });
});
