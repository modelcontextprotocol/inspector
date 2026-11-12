import { describe, it, expect } from "vitest";
import { isRuntimeControlEnvVar } from "@inspector/core/mcp/import/runtimeControlEnv.js";

describe("isRuntimeControlEnvVar", () => {
  it.each([
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "npm_config_registry",
    "NPM_CONFIG_REGISTRY",
    "npm_config_userconfig",
    "UV_INDEX_URL",
    "UV_DEFAULT_INDEX",
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PYTHONHOME",
    "PYTHONWARNINGS",
    "DOCKER_HOST",
    "DOCKER_CONFIG",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DOTNET_STARTUP_HOOKS",
    "COMPlus_EnableDiagnostics",
    "CORECLR_ENABLE_PROFILING",
    "CORECLR_PROFILER",
    "CORECLR_PROFILER_PATH",
    "CORECLR_PROFILER_PATH_64",
    "NUGET_PACKAGES",
    "OPENSSL_CONF",
    "OPENSSL_MODULES",
    "PATH",
  ])("flags %s", (name) => {
    expect(isRuntimeControlEnvVar(name)).toBe(true);
  });

  it.each(["Path", "path", "node_options", "Docker_Host", "ld_preload"])(
    "matches %s case-insensitively",
    (name) => {
      expect(isRuntimeControlEnvVar(name)).toBe(true);
    },
  );

  it.each([
    "API_KEY",
    "REGION",
    "GITHUB_TOKEN",
    "DEBUG",
    "PATHNAME",
    "MY_PATH",
    "NODE",
    "NODE_ENV",
    "NODE_NO_WARNINGS",
    "PYTHONUNBUFFERED",
    "PYTHONIOENCODING",
    "PYTHONUTF8",
    "PYTHONDONTWRITEBYTECODE",
  ])("does not flag %s", (name) => {
    expect(isRuntimeControlEnvVar(name)).toBe(false);
  });
});
