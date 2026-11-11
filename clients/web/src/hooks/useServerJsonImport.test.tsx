import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  describeLaunch,
  runtimeControlSignature,
  SECRET_MASK,
  useServerJsonImport,
  VALIDATE_DEBOUNCE_MS,
  COLLAPSE_DELAY_MS,
  HIGHLIGHT_DURATION_MS,
  type UseServerJsonImportOptions,
} from "./useServerJsonImport";

// A valid registry server.json with two runnable options; option 0 declares a
// required env var (with no default) and an optional one (with a default).
const VALID_SERVER_JSON = JSON.stringify({
  name: "io.github.acme/weather",
  packages: [
    {
      registryType: "npm",
      identifier: "weather-mcp",
      environmentVariables: [
        { name: "API_KEY", isRequired: true, description: "The key" },
        { name: "REGION", isRequired: false, default: "us" },
      ],
    },
    { registryType: "pypi", identifier: "weather-py" },
  ],
});

function setup(over: Partial<UseServerJsonImportOptions> = {}) {
  const onAddServer = over.onAddServer ?? vi.fn(async () => {});
  const opts: UseServerJsonImportOptions = {
    opened: true,
    existingIds: [],
    onAddServer,
    ...over,
  };
  const view = renderHook(
    (p: UseServerJsonImportOptions) => useServerJsonImport(p),
    { initialProps: opts },
  );
  return { ...view, onAddServer };
}

/** Set the textarea content and flush the validation debounce. */
function typeAndFlush(
  result: { current: ReturnType<typeof useServerJsonImport> },
  content: string,
) {
  act(() => result.current.setRawText(content));
  act(() => {
    vi.advanceTimersByTime(VALIDATE_DEBOUNCE_MS);
  });
}

describe("describeLaunch", () => {
  it("renders a stdio config as a quoted command line plus NAME=value env", () => {
    expect(
      describeLaunch({
        type: "stdio",
        command: "npx",
        args: ["-c", "touch /tmp/x", "-y", "pkg"],
        env: { API_KEY: "k 1", REGION: "us" },
      }),
    ).toEqual({
      kind: "command",
      value: "npx -c 'touch /tmp/x' -y pkg",
      env: [
        {
          name: "API_KEY",
          display: "API_KEY='k 1'",
          masked: false,
          runtimeControl: false,
        },
        {
          name: "REGION",
          display: "REGION=us",
          masked: false,
          runtimeControl: false,
        },
      ],
    });
  });

  it("masks a secret value the user entered", () => {
    // No document-supplied value, so whatever is set was typed by the user.
    expect(
      describeLaunch(
        { command: "npx", env: { API_KEY: "sk-live" } },
        new Map([["API_KEY", undefined]]),
      ).env,
    ).toEqual([
      {
        name: "API_KEY",
        display: `API_KEY=${SECRET_MASK}`,
        masked: true,
        runtimeControl: false,
      },
    ]);
    // A value that differs from the document's is the user's too.
    expect(
      describeLaunch(
        { command: "npx", env: { API_KEY: "sk-mine" } },
        new Map([["API_KEY", "sk-doc"]]),
      ).env[0].masked,
    ).toBe(true);
  });

  it("shows a secret's document-supplied value in clear", () => {
    expect(
      describeLaunch(
        { command: "npx", env: { SOME_LOADER_VAR: "/tmp/evil.so" } },
        new Map([["SOME_LOADER_VAR", "/tmp/evil.so"]]),
      ).env,
    ).toEqual([
      {
        name: "SOME_LOADER_VAR",
        display: "SOME_LOADER_VAR=/tmp/evil.so",
        masked: false,
        runtimeControl: false,
      },
    ]);
  });

  it("flags runtime-control vars and never masks them, even when declared secret", () => {
    const preview = describeLaunch(
      {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything@2026.10.1"],
        env: {
          npm_config_registry: "https://registry.example.invalid/",
          NODE_OPTIONS: "--require ./x.js",
        },
      },
      // Even a user-entered value of a runtime-control var stays visible.
      new Map([["NODE_OPTIONS", "--require ./doc.js"]]),
    );
    expect(preview.env).toEqual([
      {
        name: "npm_config_registry",
        display: "npm_config_registry=https://registry.example.invalid/",
        masked: false,
        runtimeControl: true,
      },
      {
        name: "NODE_OPTIONS",
        display: "NODE_OPTIONS='--require ./x.js'",
        masked: false,
        runtimeControl: true,
      },
    ]);
  });

  it("handles a stdio config with no args or env", () => {
    expect(describeLaunch({ command: "uvx" })).toEqual({
      kind: "command",
      value: "uvx",
      env: [],
    });
  });

  it("renders a remote config as its URL", () => {
    expect(
      describeLaunch({ type: "sse", url: "https://example.com/sse" }),
    ).toEqual({ kind: "url", value: "https://example.com/sse", env: [] });
    expect(
      describeLaunch({
        type: "streamable-http",
        url: "https://example.com/mcp",
      }),
    ).toEqual({ kind: "url", value: "https://example.com/mcp", env: [] });
  });
});

describe("runtimeControlSignature", () => {
  it("is empty for a config that sets no runtime-control vars", () => {
    expect(runtimeControlSignature({ command: "npx" })).toBe("");
    expect(
      runtimeControlSignature({ command: "npx", env: { API_KEY: "k" } }),
    ).toBe("");
    expect(
      runtimeControlSignature({ type: "sse", url: "https://example.com" }),
    ).toBe("");
  });

  it("changes when a flagged value changes", () => {
    const a = runtimeControlSignature({
      command: "npx",
      env: { NODE_OPTIONS: "a", API_KEY: "k" },
    });
    const b = runtimeControlSignature({
      command: "npx",
      env: { NODE_OPTIONS: "b", API_KEY: "k" },
    });
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
    // A non-flagged value does not take part.
    expect(
      runtimeControlSignature({
        command: "npx",
        env: { NODE_OPTIONS: "a", API_KEY: "other" },
      }),
    ).toBe(a);
  });
});

describe("useServerJsonImport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // The collapse/highlight timers a test leaves pending set state when they
    // fire, so they are flushed inside `act` like any other update (#2507).
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("starts empty with an info prompt and the Add button disabled", () => {
    const { result } = setup();
    expect(result.current.draft.rawText).toBe("");
    expect(result.current.canAdd).toBe(false);
    expect(result.current.validation).toEqual([
      { type: "info", message: "Paste server.json content to validate." },
    ]);
    expect(result.current.packages).toBeUndefined();
    expect(result.current.envVars).toEqual([]);
  });

  it("previews the exact launch of the selected option, runtime args included", () => {
    const { result } = setup();
    expect(result.current.launchPreview).toBeUndefined();
    typeAndFlush(
      result,
      JSON.stringify({
        name: "io.github.acme/single",
        packages: [
          {
            registryType: "npm",
            identifier: "benign-pkg",
            runtimeArguments: [
              { type: "named", name: "-c", value: "touch /tmp/pwned" },
            ],
            environmentVariables: [{ name: "TOKEN", default: "t" }],
          },
        ],
      }),
    );
    expect(result.current.launchPreview).toEqual({
      kind: "command",
      value: "npx -c 'touch /tmp/pwned' -y benign-pkg",
      env: [
        {
          name: "TOKEN",
          display: "TOKEN=t",
          masked: false,
          runtimeControl: false,
        },
      ],
    });
  });

  it("validates pasted content and enables Add", () => {
    const { result } = setup();
    typeAndFlush(result, VALID_SERVER_JSON);
    expect(result.current.canAdd).toBe(true);
    expect(result.current.defaultServerName).toBe("weather");
    expect(result.current.packages).toHaveLength(2);
    expect(result.current.validation[0]).toMatchObject({ type: "success" });
    expect(result.current.validation[1]).toMatchObject({ type: "info" });
    // Env vars of the first option, with the optional one's default prefilled.
    expect(result.current.envVars).toEqual([
      { name: "API_KEY", description: "The key", required: true, value: "" },
      { name: "REGION", description: undefined, required: false, value: "us" },
    ]);
  });

  it("surfaces a parse error for invalid JSON", () => {
    const { result } = setup();
    typeAndFlush(result, "{ not json");
    expect(result.current.canAdd).toBe(false);
    expect(result.current.validation[0].type).toBe("error");
  });

  it("flags an invalid overridden id", () => {
    const { result } = setup();
    typeAndFlush(result, VALID_SERVER_JSON);
    act(() => result.current.setServerName("bad id!"));
    expect(result.current.canAdd).toBe(false);
    expect(
      result.current.validation.some(
        (v) => v.type === "error" && v.message.includes("Server id"),
      ),
    ).toBe(true);
  });

  it("warns on a duplicate id", () => {
    const { result } = setup({ existingIds: ["weather"] });
    typeAndFlush(result, VALID_SERVER_JSON);
    expect(result.current.canAdd).toBe(false);
    expect(
      result.current.validation.some(
        (v) => v.type === "warning" && v.message.includes("already exists"),
      ),
    ).toBe(true);
  });

  it("selectPackage switches the active option and its env vars", () => {
    const { result } = setup();
    typeAndFlush(result, VALID_SERVER_JSON);
    act(() => result.current.selectPackage(1));
    expect(result.current.draft.selectedPackageIndex).toBe(1);
    // The pypi option declares no env vars.
    expect(result.current.envVars).toEqual([]);
  });

  it("setEnvVar overrides a declared env value", () => {
    const { result } = setup();
    typeAndFlush(result, VALID_SERVER_JSON);
    act(() => result.current.setEnvVar("API_KEY", "secret"));
    expect(
      result.current.envVars.find((v) => v.name === "API_KEY")?.value,
    ).toBe("secret");
  });

  it("re-opens the File Contents disclosure when cleared", () => {
    const { result } = setup();
    typeAndFlush(result, VALID_SERVER_JSON);
    act(() => result.current.setFileContentsOpen(false));
    expect(result.current.fileContentsOpen).toBe(false);
    typeAndFlush(result, "");
    expect(result.current.fileContentsOpen).toBe(true);
  });

  it("flashes then auto-collapses the disclosure after content loads", () => {
    const { result } = setup();
    act(() => result.current.setRawText(VALID_SERVER_JSON));
    expect(result.current.fileContentsOpen).toBe(true);
    act(() => {
      vi.advanceTimersByTime(COLLAPSE_DELAY_MS);
    });
    expect(result.current.fileContentsHighlight).toBe(true);
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_DURATION_MS);
    });
    expect(result.current.fileContentsHighlight).toBe(false);
    expect(result.current.fileContentsOpen).toBe(false);
  });

  it("resets its state when the modal is re-opened", () => {
    const { result, rerender } = setup({ opened: false });
    // Open, dirty the draft, then close and re-open — the draft must clear.
    rerender({ opened: true, existingIds: [], onAddServer: vi.fn() });
    typeAndFlush(result, VALID_SERVER_JSON);
    expect(result.current.draft.rawText).not.toBe("");
    rerender({ opened: false, existingIds: [], onAddServer: vi.fn() });
    rerender({ opened: true, existingIds: [], onAddServer: vi.fn() });
    expect(result.current.draft.rawText).toBe("");
  });

  it("pickFile reads a file into the draft", async () => {
    const { result } = setup();
    const file = new File([VALID_SERVER_JSON], "server.json");
    await act(async () => {
      await result.current.pickFile(file);
    });
    expect(result.current.draft.rawText).toBe(VALID_SERVER_JSON);
  });

  it("pickFile ignores a null file", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.pickFile(null);
    });
    expect(result.current.draft.rawText).toBe("");
  });

  it("pickFile surfaces a read error", async () => {
    const { result } = setup();
    const file = new File(["x"], "server.json");
    vi.spyOn(file, "text").mockRejectedValue(new Error("read boom"));
    await act(async () => {
      await result.current.pickFile(file);
    });
    expect(
      result.current.validation.some((v) => v.message.includes("read boom")),
    ).toBe(true);
  });

  it("submit persists the selected server and resolves true", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({ onAddServer });
    typeAndFlush(result, VALID_SERVER_JSON);
    let ok = false;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(true);
    expect(onAddServer).toHaveBeenCalledWith("weather", expect.any(Object));
  });

  it("submit refuses invalid content", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({ onAddServer });
    typeAndFlush(result, "{ not json");
    let ok = true;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(false);
    expect(onAddServer).not.toHaveBeenCalled();
    expect(
      result.current.validation.some((v) =>
        v.message.includes("Fix the validation errors"),
      ),
    ).toBe(true);
  });

  it("submit refuses a duplicate id", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({ existingIds: ["weather"], onAddServer });
    typeAndFlush(result, VALID_SERVER_JSON);
    let ok = true;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(false);
    expect(onAddServer).not.toHaveBeenCalled();
  });

  it("refuses a valid-to-valid edit submitted before the preview catches up", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({ onAddServer });
    typeAndFlush(result, VALID_SERVER_JSON);
    expect(result.current.canAdd).toBe(true);
    const replacement = JSON.stringify({
      name: "io.github.acme/weather",
      packages: [
        {
          registryType: "npm",
          identifier: "weather-mcp",
          runtimeArguments: [
            { type: "named", name: "-c", value: "touch /tmp/x" },
          ],
        },
      ],
    });
    // Still inside the debounce window: the preview shows the old launch.
    act(() => result.current.setRawText(replacement));
    expect(result.current.canAdd).toBe(false);
    expect(result.current.launchPreview?.value).toBe("npx -y weather-mcp");
    let ok = true;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(false);
    expect(onAddServer).not.toHaveBeenCalled();
    expect(
      result.current.validation.some((v) =>
        v.message.includes("Wait for validation to finish"),
      ),
    ).toBe(true);
    // Once the debounce settles the new launch is shown and Add re-enables.
    act(() => {
      vi.advanceTimersByTime(VALIDATE_DEBOUNCE_MS);
    });
    expect(result.current.canAdd).toBe(true);
    expect(result.current.launchPreview?.value).toBe(
      "npx -c 'touch /tmp/x' -y weather-mcp",
    );
  });

  it("submit surfaces an onAddServer failure", async () => {
    const onAddServer = vi.fn(async () => {
      throw new Error("save boom");
    });
    const { result } = setup({ onAddServer });
    typeAndFlush(result, VALID_SERVER_JSON);
    let ok = true;
    await act(async () => {
      ok = await result.current.submit();
    });
    expect(ok).toBe(false);
    expect(
      result.current.validation.some((v) => v.message.includes("save boom")),
    ).toBe(true);
  });
  describe("runtime-control env vars", () => {
    // Declares a runtime-control default (marked secret, which must not hide
    // it), a registry redirect, and an ordinary secret.
    const RUNTIME_CONTROL_JSON = JSON.stringify({
      name: "io.github.acme/everything",
      packages: [
        {
          registryType: "npm",
          identifier: "@acme/server-everything",
          version: "1.0.0",
          environmentVariables: [
            {
              name: "npm_config_registry",
              default: "https://registry.example.invalid/",
            },
            {
              name: "NODE_OPTIONS",
              isSecret: true,
              default: "--require ./x.js",
            },
            { name: "API_KEY", isSecret: true, default: "sk-live" },
            { name: "TOKEN", isSecret: true },
          ],
        },
      ],
    });

    it("shows every document-supplied value and flags the runtime-control ones", () => {
      const { result } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      expect(result.current.launchPreview?.env).toEqual([
        {
          name: "npm_config_registry",
          display: "npm_config_registry=https://registry.example.invalid/",
          masked: false,
          runtimeControl: true,
        },
        {
          name: "NODE_OPTIONS",
          display: "NODE_OPTIONS='--require ./x.js'",
          masked: false,
          runtimeControl: true,
        },
        {
          // Declared secret, but the document supplied the value: not hidden.
          name: "API_KEY",
          display: "API_KEY=sk-live",
          masked: false,
          runtimeControl: false,
        },
      ]);
      // The form hides only the secret the document supplies no value for.
      expect(
        result.current.envVars.map((v) => [v.name, v.isSecret ?? false]),
      ).toEqual([
        ["npm_config_registry", false],
        ["NODE_OPTIONS", false],
        ["API_KEY", false],
        ["TOKEN", true],
      ]);
    });

    it("never masks the saved value of a name declared twice", () => {
      const { result } = setup();
      typeAndFlush(
        result,
        JSON.stringify({
          name: "io.github.acme/dup",
          packages: [
            {
              registryType: "npm",
              identifier: "dup-pkg",
              environmentVariables: [
                { name: "FOO", default: "doc-value" },
                { name: "FOO", isSecret: true },
              ],
            },
          ],
        }),
      );
      expect(result.current.launchPreview?.env).toEqual([
        {
          name: "FOO",
          display: "FOO=doc-value",
          masked: false,
          runtimeControl: false,
        },
      ]);
      // Neither field hides it: the document supplies FOO's value.
      expect(result.current.envVars.map((v) => v.isSecret ?? false)).toEqual([
        false,
        false,
      ]);
    });

    it("masks secret values the user enters", () => {
      const { result } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      act(() => result.current.setEnvVar("API_KEY", "sk-mine"));
      act(() => result.current.setEnvVar("TOKEN", "t-mine"));
      const byName = Object.fromEntries(
        (result.current.launchPreview?.env ?? []).map((e) => [e.name, e]),
      );
      expect(byName.API_KEY.display).toBe(`API_KEY=${SECRET_MASK}`);
      expect(byName.TOKEN.display).toBe(`TOKEN=${SECRET_MASK}`);
      // Typing the document's own value back in shows it again.
      act(() => result.current.setEnvVar("API_KEY", "sk-live"));
      expect(
        result.current.launchPreview?.env.find((e) => e.name === "API_KEY")
          ?.masked,
      ).toBe(false);
    });

    it("keeps Add disabled until the user confirms", () => {
      const { result } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      expect(result.current.runtimeControlAcknowledged).toBe(false);
      expect(result.current.canAdd).toBe(false);
      act(() => result.current.setRuntimeControlAcknowledged(true));
      expect(result.current.runtimeControlAcknowledged).toBe(true);
      expect(result.current.canAdd).toBe(true);
      act(() => result.current.setRuntimeControlAcknowledged(false));
      expect(result.current.runtimeControlAcknowledged).toBe(false);
      expect(result.current.canAdd).toBe(false);
    });

    it("withdraws the confirmation when a flagged value is edited", () => {
      const { result } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      act(() => result.current.setRuntimeControlAcknowledged(true));
      act(() =>
        result.current.setEnvVar("NODE_OPTIONS", "--require ./other.js"),
      );
      expect(result.current.runtimeControlAcknowledged).toBe(false);
      expect(result.current.canAdd).toBe(false);
      // Editing a non-flagged value leaves a confirmation in place.
      act(() => result.current.setRuntimeControlAcknowledged(true));
      act(() => result.current.setEnvVar("API_KEY", "sk-other"));
      expect(result.current.runtimeControlAcknowledged).toBe(true);
    });

    it("needs no confirmation once every flagged value is cleared", () => {
      const { result } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      act(() => result.current.setEnvVar("NODE_OPTIONS", ""));
      act(() => result.current.setEnvVar("npm_config_registry", ""));
      expect(
        result.current.launchPreview?.env.map((entry) => entry.name),
      ).toEqual(["API_KEY"]);
      expect(result.current.canAdd).toBe(true);
    });

    it("submit refuses unconfirmed values and saves confirmed ones verbatim", async () => {
      const { result, onAddServer } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      let ok = true;
      await act(async () => {
        ok = await result.current.submit();
      });
      expect(ok).toBe(false);
      expect(onAddServer).not.toHaveBeenCalled();
      expect(
        result.current.validation.some((v) =>
          v.message.includes("Confirm the runtime-control environment"),
        ),
      ).toBe(true);

      act(() => result.current.setRuntimeControlAcknowledged(true));
      // Confirming clears the refusal message.
      expect(
        result.current.validation.some((v) =>
          v.message.includes("Confirm the runtime-control environment"),
        ),
      ).toBe(false);
      await act(async () => {
        ok = await result.current.submit();
      });
      expect(ok).toBe(true);
      expect(onAddServer).toHaveBeenCalledWith("everything", {
        type: "stdio",
        command: "npx",
        args: ["-y", "@acme/server-everything@1.0.0"],
        env: {
          npm_config_registry: "https://registry.example.invalid/",
          NODE_OPTIONS: "--require ./x.js",
          API_KEY: "sk-live",
        },
      });
    });

    it("drops the confirmation when the modal is re-opened", () => {
      const { result, rerender, onAddServer } = setup();
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      act(() => result.current.setRuntimeControlAcknowledged(true));
      rerender({ opened: false, existingIds: [], onAddServer });
      rerender({ opened: true, existingIds: [], onAddServer });
      typeAndFlush(result, RUNTIME_CONTROL_JSON);
      expect(result.current.runtimeControlAcknowledged).toBe(false);
      expect(result.current.canAdd).toBe(false);
    });
  });
});
