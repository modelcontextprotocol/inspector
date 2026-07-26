import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
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

describe("useServerJsonImport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
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
});
