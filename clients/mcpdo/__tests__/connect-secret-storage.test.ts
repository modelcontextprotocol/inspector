import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SecretStorageInfo } from "@inspector/core/auth/secret-storage-info.js";

const getSecretStorageInfo = vi.fn<() => Promise<SecretStorageInfo>>();
const warnAboutSecretStorage =
  vi.fn<(info: SecretStorageInfo, opts?: { force?: boolean }) => void>();

// Only these two names are consumed from the core module by mcp.ts; the rest
// of the real module is preserved so its other importers are unaffected.
vi.mock(
  "@inspector/core/auth/node/secret-store-selection.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@inspector/core/auth/node/secret-store-selection.js")
      >();
    return {
      ...actual,
      getSecretStorageInfo: (...args: unknown[]) =>
        (getSecretStorageInfo as (...a: unknown[]) => unknown)(...args),
      warnAboutSecretStorage: (...args: unknown[]) =>
        (warnAboutSecretStorage as (...a: unknown[]) => unknown)(...args),
    };
  },
);

const { surfaceSecretStorageAtConnect } =
  await import("../src/connection/mcp.js");

describe("surfaceSecretStorageAtConnect", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSecretStorageInfo.mockReset();
    warnAboutSecretStorage.mockReset();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  it("re-surfaces the store warning once, forced (R5)", async () => {
    const info: SecretStorageInfo = {
      kind: "file",
      reason: "fallback",
      durable: true,
      path: "/home/u/.mcp-inspector/secrets.json",
      plaintext: true,
    };
    getSecretStorageInfo.mockResolvedValue(info);

    await surfaceSecretStorageAtConnect();

    expect(warnAboutSecretStorage).toHaveBeenCalledWith(info, { force: true });
    // Non-memory stores get no extra mcpdo-specific line.
    expect(stderr).not.toHaveBeenCalled();
  });

  it("warns that a memory store cannot persist across mcpdo's processes (R4)", async () => {
    getSecretStorageInfo.mockResolvedValue({
      kind: "memory",
      reason: "configured",
      durable: false,
    });

    await surfaceSecretStorageAtConnect();

    expect(warnAboutSecretStorage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "memory" }),
      { force: true },
    );
    const printed = stderr.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    expect(printed).toContain("MCP_INSPECTOR_SECRET_STORE=memory");
    expect(printed).toContain("separate processes");
    expect(printed).toContain('Use "file" or "keyring"');
  });
});
