import { describe, it, expect } from "vitest";
import {
  parseServerJson,
  buildServerConfig,
  buildServerConfigForSelection,
  deriveServerId,
  resolveServerId,
  selectServerJsonOption,
} from "@inspector/core/mcp/import/serverJson.js";

const npmServerJson = JSON.stringify({
  $schema:
    "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.my-username/weather",
  description: "An MCP server for weather information.",
  version: "1.0.1",
  packages: [
    {
      registryType: "npm",
      identifier: "@my-username/mcp-weather-server",
      version: "1.0.1",
      transport: { type: "stdio" },
      environmentVariables: [
        {
          description: "Your API key",
          isRequired: true,
          isSecret: true,
          name: "YOUR_API_KEY",
        },
        { name: "LOG_LEVEL", default: "info" },
      ],
    },
  ],
});

describe("deriveServerId", () => {
  it("takes the last path segment and sanitizes it", () => {
    expect(deriveServerId("io.github.user/weather")).toBe("weather");
    expect(deriveServerId("com.example/My Server!")).toBe("My-Server");
    expect(deriveServerId("plain-name")).toBe("plain-name");
  });

  it("falls back to 'server' when nothing usable remains", () => {
    expect(deriveServerId("io.github.user/")).toBe("server");
    expect(deriveServerId("///")).toBe("server");
  });
});

describe("parseServerJson — packages", () => {
  it("parses an npm package into an npx stdio config", () => {
    const parsed = parseServerJson(npmServerJson);
    expect(parsed.serverName).toBe("weather");
    expect(parsed.fullName).toBe("io.github.my-username/weather");
    expect(parsed.options).toHaveLength(1);
    const opt = parsed.options[0];
    expect(opt.registryType).toBe("npm");
    expect(opt.runtimeHint).toBe("npx");
    expect(opt.baseConfig).toMatchObject({
      type: "stdio",
      command: "npx",
      args: ["-y", "@my-username/mcp-weather-server@1.0.1"],
    });
    // Only the var with a default goes into base env; the required secret is
    // surfaced for the user to fill.
    if (opt.baseConfig.type === "stdio") {
      expect(opt.baseConfig.env).toEqual({ LOG_LEVEL: "info" });
      // The registry server.json schema carries no working-directory concept,
      // so a parsed package never sets cwd (documented in serverJson.ts).
      expect(opt.baseConfig.cwd).toBeUndefined();
    }
    expect(opt.envVars).toEqual([
      {
        name: "YOUR_API_KEY",
        description: "Your API key",
        required: true,
        isSecret: true,
      },
      { name: "LOG_LEVEL", required: false, default: "info" },
    ]);
  });

  it("maps pypi/oci/nuget registry types to their runtimes", () => {
    const make = (registryType: string, identifier: string) =>
      parseServerJson(
        JSON.stringify({
          name: "com.example/x",
          packages: [{ registryType, identifier, version: "2.0.0" }],
        }),
      ).options[0];

    expect(make("pypi", "weather-py").baseConfig).toMatchObject({
      command: "uvx",
      args: ["weather-py"],
    });
    expect(make("oci", "docker.io/u/app:1.0.0").baseConfig).toMatchObject({
      command: "docker",
      args: ["run", "-i", "--rm", "docker.io/u/app:1.0.0"],
    });
    expect(make("nuget", "Acme.Mcp").baseConfig).toMatchObject({
      command: "dnx",
      args: ["Acme.Mcp@2.0.0"],
    });
  });

  it("resolves runtime and package arguments in order", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/args",
        packages: [
          {
            registryType: "npm",
            identifier: "pkg",
            runtimeArguments: [
              { type: "named", name: "--node-opt", value: "x" },
            ],
            packageArguments: [
              { type: "positional", value: "subcommand" },
              { type: "named", name: "--port", value: "8080" },
              { type: "named", name: "--flag" },
              { type: "named", value: "orphan" }, // named without a name → skipped
              { type: "positional" },
              "not-an-object",
            ],
          },
        ],
      }),
    );
    expect(parsed.options[0].baseConfig).toMatchObject({
      command: "npx",
      args: [
        "--node-opt",
        "x",
        "-y",
        "pkg",
        "subcommand",
        "--port",
        "8080",
        "--flag",
      ],
    });
  });

  it("appends docker package args after the image", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/d",
        packages: [
          {
            registryType: "oci",
            identifier: "img:1",
            packageArguments: [{ type: "positional", value: "--inside" }],
          },
        ],
      }),
    );
    expect(parsed.options[0].baseConfig).toMatchObject({
      args: ["run", "-i", "--rm", "img:1", "--inside"],
    });
  });

  it("forwards declared env vars into OCI containers via -e flags", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/d",
        packages: [
          {
            registryType: "oci",
            identifier: "img:1",
            environmentVariables: [
              { name: "API_KEY", isRequired: true },
              { name: "LOG", default: "info" },
            ],
          },
        ],
      }),
    );
    const opt = parsed.options[0];
    // -e KEY flags go before the image so docker forwards them into the
    // container (sourced from config.env at connect time).
    expect(opt.baseConfig).toMatchObject({
      command: "docker",
      args: ["run", "-i", "--rm", "-e", "API_KEY", "-e", "LOG", "img:1"],
    });
    if (opt.baseConfig.type === "stdio") {
      expect(opt.baseConfig.env).toEqual({ LOG: "info" });
    }
  });

  it("skips unsupported (mcpb) and malformed packages", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/mix",
        packages: [
          { registryType: "mcpb", identifier: "https://x/y.mcpb" },
          { registryType: "npm" }, // missing identifier
          null,
          { registryType: "npm", identifier: "good" },
        ],
      }),
    );
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0].identifier).toBe("good");
  });
});

describe("parseServerJson — remotes", () => {
  it("parses streamable-http and sse remotes", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/acme",
        remotes: [
          { type: "streamable-http", url: "https://a.example.com/mcp" },
          { type: "sse", url: "https://a.example.com/sse" },
        ],
      }),
    );
    expect(parsed.options).toHaveLength(2);
    // Remotes are labeled "remote", with the transport carried in runtimeHint.
    expect(parsed.options[0].registryType).toBe("remote");
    expect(parsed.options[0].runtimeHint).toBe("streamable-http");
    expect(parsed.options[1].registryType).toBe("remote");
    expect(parsed.options[1].runtimeHint).toBe("sse");
    expect(parsed.options[0].baseConfig).toEqual({
      type: "streamable-http",
      url: "https://a.example.com/mcp",
    });
    expect(parsed.options[1].baseConfig).toEqual({
      type: "sse",
      url: "https://a.example.com/sse",
    });
  });

  it("substitutes URL template variables with their defaults", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/multi",
        remotes: [
          {
            type: "streamable-http",
            url: "https://api.example.com/{region}/mcp",
            variables: { region: { default: "us-east-1" } },
          },
        ],
      }),
    );
    expect(parsed.options[0].identifier).toBe(
      "https://api.example.com/us-east-1/mcp",
    );
  });

  it("leaves a template token intact when no default is declared", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/t",
        remotes: [
          {
            type: "streamable-http",
            url: "https://{tenant}.example.com/mcp",
            variables: { tenant: { isRequired: true } },
          },
        ],
      }),
    );
    expect(parsed.options[0].identifier).toBe(
      "https://{tenant}.example.com/mcp",
    );
  });

  it("skips remotes without a url", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/r",
        remotes: [
          { type: "streamable-http" },
          { type: "sse", url: "https://x/sse" },
        ],
      }),
    );
    expect(parsed.options).toHaveLength(1);
  });
});

describe("parseServerJson — wrapper + snake_case + errors", () => {
  it("accepts a { server: {...} } wrapper", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        server: {
          name: "com.example/wrapped",
          packages: [{ registryType: "npm", identifier: "p" }],
        },
      }),
    );
    expect(parsed.fullName).toBe("com.example/wrapped");
  });

  it("reads snake_case registry fields", () => {
    const parsed = parseServerJson(
      JSON.stringify({
        name: "com.example/snake",
        packages: [
          {
            registry_type: "npm",
            identifier: "snake-pkg",
            environment_variables: [
              { name: "TOKEN", is_required: true, is_secret: true },
            ],
            package_arguments: [{ type: "positional", value: "go" }],
          },
        ],
      }),
    );
    const opt = parsed.options[0];
    expect(opt.registryType).toBe("npm");
    expect(opt.baseConfig).toMatchObject({ args: ["-y", "snake-pkg", "go"] });
    expect(opt.envVars[0]).toMatchObject({ required: true, isSecret: true });
  });

  it("throws on invalid JSON, non-object, and missing name", () => {
    expect(() => parseServerJson("nope")).toThrow(/Invalid JSON/);
    expect(() => parseServerJson("[]")).toThrow(/top level/);
    expect(() => parseServerJson("{}")).toThrow(/name/);
  });

  it("throws when there is no runnable package or remote", () => {
    expect(() =>
      parseServerJson(
        JSON.stringify({
          name: "com.example/empty",
          packages: [{ registryType: "mcpb", identifier: "x.mcpb" }],
        }),
      ),
    ).toThrow(/No runnable/);
  });
});

describe("buildServerConfig", () => {
  it("merges env overrides over declared defaults", () => {
    const opt = parseServerJson(npmServerJson).options[0];
    const config = buildServerConfig(opt, {
      YOUR_API_KEY: "secret",
      LOG_LEVEL: "debug",
    });
    expect(config).toMatchObject({
      type: "stdio",
      command: "npx",
      env: { YOUR_API_KEY: "secret", LOG_LEVEL: "debug" },
    });
  });

  it("drops env keys whose override is empty", () => {
    const opt = parseServerJson(npmServerJson).options[0];
    const config = buildServerConfig(opt, { LOG_LEVEL: "" });
    if (config.type === "stdio") {
      expect(config.env).toBeUndefined();
    }
  });

  it("returns a remote config unchanged (ignores env overrides)", () => {
    const opt = parseServerJson(
      JSON.stringify({
        name: "com.example/r",
        remotes: [{ type: "streamable-http", url: "https://x/mcp" }],
      }),
    ).options[0];
    const config = buildServerConfig(opt, { ANYTHING: "x" });
    expect(config).toEqual({ type: "streamable-http", url: "https://x/mcp" });
  });
});

describe("resolveServerId", () => {
  it("uses the trimmed override when present, else the derived name", () => {
    const parsed = parseServerJson(npmServerJson);
    expect(resolveServerId(parsed)).toBe("weather");
    expect(resolveServerId(parsed, "  custom  ")).toBe("custom");
    expect(resolveServerId(parsed, "   ")).toBe("weather");
  });
});

describe("selectServerJsonOption", () => {
  const multi = JSON.stringify({
    name: "com.example/multi",
    packages: [
      { registryType: "npm", identifier: "@me/a" },
      { registryType: "pypi", identifier: "b" },
    ],
  });

  it("defaults to the first option with a valid, free id", () => {
    const sel = selectServerJsonOption(parseServerJson(npmServerJson));
    expect(sel.selectedIndex).toBe(0);
    expect(sel.selectedOption.registryType).toBe("npm");
    expect(sel.serverId).toBe("weather");
    expect(sel.idIsValid).toBe(true);
    expect(sel.idIsDuplicate).toBe(false);
  });

  it("clamps an out-of-range selected index", () => {
    const sel = selectServerJsonOption(parseServerJson(multi), {
      selectedIndex: 5,
    });
    expect(sel.selectedIndex).toBe(1);
    expect(sel.selectedOption.registryType).toBe("pypi");
  });

  it("flags an invalid id override", () => {
    const sel = selectServerJsonOption(parseServerJson(npmServerJson), {
      idOverride: "bad id!",
    });
    expect(sel.serverId).toBe("bad id!");
    expect(sel.idIsValid).toBe(false);
  });

  it("flags a duplicate id against existingIds", () => {
    const sel = selectServerJsonOption(parseServerJson(npmServerJson), {
      existingIds: ["weather"],
    });
    expect(sel.idIsDuplicate).toBe(true);
  });
});

describe("buildServerConfigForSelection", () => {
  it("merges only the selected option's declared env vars", () => {
    const opt = parseServerJson(npmServerJson).options[0];
    const config = buildServerConfigForSelection(opt, {
      YOUR_API_KEY: "secret",
      NOT_DECLARED: "ignored",
    });
    expect(config).toMatchObject({
      type: "stdio",
      env: { YOUR_API_KEY: "secret", LOG_LEVEL: "info" },
    });
    if (config.type === "stdio") {
      expect(config.env?.NOT_DECLARED).toBeUndefined();
    }
  });
});
