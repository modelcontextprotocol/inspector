import {
  isStdioServerConfig,
  isHttpServerConfig,
  getStdioCommand,
  getHttpUrl,
  validateServerConfig,
  hasValidConfig,
  createDefaultStdioConfig,
  createDefaultHttpConfig,
  getConfigSummary,
} from "../serverConfigValidation";
import {
  StdioServerConfig,
  HttpServerConfig,
} from "../../components/multiserver/types/multiserver";

describe("serverConfigValidation", () => {
  describe("Type Guards", () => {
    it("should identify valid stdio server config", () => {
      const stdioServer: StdioServerConfig = {
        id: "test-stdio",
        name: "Test Stdio Server",
        transportType: "stdio",
        config: {
          command: "node server.js",
          args: ["--port", "3000"],
          env: { NODE_ENV: "development" },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(isStdioServerConfig(stdioServer)).toBe(true);
      expect(isHttpServerConfig(stdioServer)).toBe(false);
    });

    it("should identify valid HTTP server config", () => {
      const httpServer: HttpServerConfig = {
        id: "test-http",
        name: "Test HTTP Server",
        transportType: "streamable-http",
        config: {
          url: "https://api.example.com/mcp",
          headers: {},
          bearerToken: "token123",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(isHttpServerConfig(httpServer)).toBe(true);
      expect(isStdioServerConfig(httpServer)).toBe(false);
    });

    it("should handle undefined config", () => {
      const invalidServer = {
        id: "test-invalid",
        name: "Invalid Server",
        transportType: "stdio",
        config: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      expect(isStdioServerConfig(invalidServer)).toBe(false);
      expect(isHttpServerConfig(invalidServer)).toBe(false);
    });

    it("should handle null config", () => {
      const invalidServer = {
        id: "test-invalid",
        name: "Invalid Server",
        transportType: "stdio",
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      expect(isStdioServerConfig(invalidServer)).toBe(false);
      expect(isHttpServerConfig(invalidServer)).toBe(false);
    });
  });

  describe("Safe Property Access", () => {
    it("should safely get stdio command", () => {
      const stdioServer: StdioServerConfig = {
        id: "test-stdio",
        name: "Test Stdio Server",
        transportType: "stdio",
        config: {
          command: "node server.js",
          args: [],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(getStdioCommand(stdioServer)).toBe("node server.js");
    });

    it("should return null for invalid stdio config", () => {
      const invalidServer = {
        id: "test-invalid",
        name: "Invalid Server",
        transportType: "stdio",
        config: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      expect(getStdioCommand(invalidServer)).toBe(null);
    });

    it("should safely get HTTP URL", () => {
      const httpServer: HttpServerConfig = {
        id: "test-http",
        name: "Test HTTP Server",
        transportType: "streamable-http",
        config: {
          url: "https://api.example.com/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(getHttpUrl(httpServer)).toBe("https://api.example.com/mcp");
    });

    it("should return null for invalid HTTP config", () => {
      const invalidServer = {
        id: "test-invalid",
        name: "Invalid Server",
        transportType: "streamable-http",
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      expect(getHttpUrl(invalidServer)).toBe(null);
    });
  });

  describe("Config Validation", () => {
    it("should validate and fix valid stdio config", () => {
      const validConfig = {
        id: "test-stdio",
        name: "Test Server",
        transportType: "stdio",
        config: {
          command: "node server.js",
          args: ["--port", "3000"],
          env: { NODE_ENV: "development" },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = validateServerConfig(validConfig);
      expect(result).not.toBe(null);
      expect(result?.config).toBeDefined();
      expect((result?.config as any).command).toBe("node server.js");
    });

    it("should create default config for missing config", () => {
      const configWithoutConfig = {
        id: "test-stdio",
        name: "Test Server",
        transportType: "stdio",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = validateServerConfig(configWithoutConfig);
      expect(result).not.toBe(null);
      expect(result?.config).toBeDefined();
      expect((result?.config as any).command).toBe("");
      expect((result?.config as any).args).toEqual([]);
      expect((result?.config as any).env).toEqual({});
    });

    it("should return null for completely invalid config", () => {
      const invalidConfig = null;
      const result = validateServerConfig(invalidConfig);
      expect(result).toBe(null);
    });

    it("should return null for config without required fields", () => {
      const invalidConfig = {
        name: "Test Server",
        // Missing id and transportType
      };

      const result = validateServerConfig(invalidConfig);
      expect(result).toBe(null);
    });
  });

  describe("Config Validation Check", () => {
    it("should return true for valid stdio config", () => {
      const validServer: StdioServerConfig = {
        id: "test-stdio",
        name: "Test Server",
        transportType: "stdio",
        config: {
          command: "node server.js",
          args: [],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(hasValidConfig(validServer)).toBe(true);
    });

    it("should return false for stdio config without command", () => {
      const invalidServer: any = {
        id: "test-stdio",
        name: "Test Server",
        transportType: "stdio",
        config: {
          command: "",
          args: [],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(hasValidConfig(invalidServer)).toBe(false);
    });

    it("should return true for valid HTTP config", () => {
      const validServer: HttpServerConfig = {
        id: "test-http",
        name: "Test Server",
        transportType: "streamable-http",
        config: {
          url: "https://api.example.com/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(hasValidConfig(validServer)).toBe(true);
    });

    it("should return false for HTTP config without URL", () => {
      const invalidServer: any = {
        id: "test-http",
        name: "Test Server",
        transportType: "streamable-http",
        config: {
          url: "",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(hasValidConfig(invalidServer)).toBe(false);
    });
  });

  describe("Default Configs", () => {
    it("should create valid default stdio config", () => {
      const defaultConfig = createDefaultStdioConfig();
      expect(defaultConfig.command).toBe("");
      expect(defaultConfig.args).toEqual([]);
      expect(defaultConfig.env).toEqual({});
    });

    it("should create valid default HTTP config", () => {
      const defaultConfig = createDefaultHttpConfig();
      expect(defaultConfig.url).toBe("");
      expect(defaultConfig.headers).toEqual({});
    });
  });

  describe("Config Summary", () => {
    it("should return command for stdio server", () => {
      const stdioServer: StdioServerConfig = {
        id: "test-stdio",
        name: "Test Server",
        transportType: "stdio",
        config: {
          command: "node server.js",
          args: [],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(getConfigSummary(stdioServer)).toBe("node server.js");
    });

    it("should return URL for HTTP server", () => {
      const httpServer: HttpServerConfig = {
        id: "test-http",
        name: "Test Server",
        transportType: "streamable-http",
        config: {
          url: "https://api.example.com/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(getConfigSummary(httpServer)).toBe("https://api.example.com/mcp");
    });

    it("should return fallback message for invalid config", () => {
      const invalidServer: any = {
        id: "test-invalid",
        name: "Test Server",
        transportType: "stdio",
        config: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(getConfigSummary(invalidServer)).toBe("No command configured");
    });
  });
});
