/**
 * The store-selection policy (#1950).
 *
 * The two questions this file exists to pin down are the ones a reviewer
 * would want proof of, because getting either wrong silently changes where
 * a user's secret goes:
 *
 *  1. an unreachable keychain falls back rather than failing, and says so;
 *  2. the fallback is `memory` in a container with nothing durable
 *     mounted, and `file` otherwise.
 *
 * `resolveSecretStore` caches its answer for the process, so each case
 * that exercises it goes through `vi.resetModules()` + a fresh dynamic
 * import — the same technique the keyring-unloadable cases in
 * `secret-store.test.ts` use, and for the same reason. The keychain probe
 * is mocked because CI has no libsecret; the container and mount
 * predicates are driven directly rather than through a real container,
 * which is what makes them worth exporting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  chooseFallbackKind,
  isOnMountPoint,
  parseSecretStoreEnv,
  warnAboutSecretStorage,
} from "@inspector/core/auth/node/secret-store-selection.js";
import {
  InMemorySecretStore,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import type { SecretStorageInfo } from "@inspector/core/auth/secret-storage-info.js";

const ENV_KEYS = [
  "MCP_INSPECTOR_SECRET_STORE",
  "MCP_INSPECTOR_SECRET_FILE",
  "MCP_INSPECTOR_SECRET_KEY",
  "MCP_STORAGE_DIR",
  "KUBERNETES_SERVICE_HOST",
];

let saved: Record<string, string | undefined>;
let tmpDir: string;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-selection-"));
});

afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Load a fresh copy of the selection module with the keychain probe forced
 * to a given answer. Fresh because the resolution is cached per module
 * instance, which is exactly the behavior we don't want leaking between
 * cases.
 */
async function loadWithProbe(available: boolean, detail = "no D-Bus session") {
  vi.resetModules();
  vi.doMock("@inspector/core/auth/node/secret-store.js", async () => {
    const actual = await vi.importActual<
      typeof import("@inspector/core/auth/node/secret-store.js")
    >("@inspector/core/auth/node/secret-store.js");
    return {
      ...actual,
      probeKeyringAvailable: vi.fn(async () =>
        available ? { available: true } : { available: false, detail },
      ),
    };
  });
  return import("@inspector/core/auth/node/secret-store-selection.js");
}

describe("parseSecretStoreEnv", () => {
  it("accepts each kind, case- and whitespace-insensitively", () => {
    expect(parseSecretStoreEnv("keyring")).toBe("keyring");
    expect(parseSecretStoreEnv(" FILE ")).toBe("file");
    expect(parseSecretStoreEnv("Memory")).toBe("memory");
  });

  it("treats unset and blank as unset", () => {
    expect(parseSecretStoreEnv(undefined)).toBeUndefined();
    expect(parseSecretStoreEnv("  ")).toBeUndefined();
  });

  it("warns and falls through on a typo rather than refusing to start", () => {
    // A misspelled env var in a compose file should not be the reason the
    // Inspector won't boot — the automatic policy is a working default.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseSecretStoreEnv("keychain")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("keyring, file, memory"),
    );
  });
});

describe("chooseFallbackKind", () => {
  it("uses memory in a container with nothing mounted", () => {
    // The honest answer: a file in the writable layer is discarded by
    // `docker run --rm` and by any image update, so promising durability
    // there is worse than declining to.
    expect(chooseFallbackKind({ container: true, mounted: false })).toBe(
      "memory",
    );
  });

  it("uses file in a container once a volume is mounted", () => {
    // Mounting the volume *is* the user saying this directory should
    // survive, so no extra configuration should be needed to honor it.
    expect(chooseFallbackKind({ container: true, mounted: true })).toBe("file");
  });

  it("uses file outside a container, mounted or not", () => {
    expect(chooseFallbackKind({ container: false, mounted: false })).toBe(
      "file",
    );
    expect(chooseFallbackKind({ container: false, mounted: true })).toBe(
      "file",
    );
  });
});

describe("isContainer", () => {
  /**
   * Load the module with `node:fs` stubbed, so each detection signal can be
   * exercised on a developer's laptop. The three exist because no single one
   * covers the runtimes people use — Docker, Podman/containerd, and
   * Kubernetes each announce themselves differently.
   */
  async function loadWithFs(opts: {
    dockerenv?: boolean;
    containerenv?: boolean;
    cgroup?: string | Error;
  }) {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: (p: string) => {
          if (p === "/.dockerenv") return !!opts.dockerenv;
          if (p === "/run/.containerenv") return !!opts.containerenv;
          return actual.existsSync(p);
        },
        readFileSync: (p: string, enc?: unknown) => {
          if (p === "/proc/1/cgroup") {
            if (opts.cgroup instanceof Error) throw opts.cgroup;
            if (opts.cgroup === undefined) throw new Error("ENOENT");
            return opts.cgroup;
          }
          return actual.readFileSync(p, enc as never);
        },
      };
    });
    return import("@inspector/core/auth/node/secret-store-selection.js");
  }

  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("is true inside Kubernetes, without touching the filesystem", async () => {
    process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
    const mod = await loadWithFs({});
    expect(mod.isContainer()).toBe(true);
  });

  it("is true when /.dockerenv exists", async () => {
    const mod = await loadWithFs({ dockerenv: true });
    expect(mod.isContainer()).toBe(true);
  });

  it("is true when Podman's /run/.containerenv exists", async () => {
    // Rootless Podman has no `/.dockerenv`, and its cgroup line often does
    // not contain the literal "podman" either — this file is the signal that
    // is reliably there. Missing it classified the container as a host, so a
    // keychain-less box wrote a "durable" file into the ephemeral layer.
    const mod = await loadWithFs({ containerenv: true });
    expect(mod.isContainer()).toBe(true);
  });

  it("is true for a libpod cgroup path", async () => {
    // What Podman actually writes: `/machine.slice/libpod-<id>.scope`.
    const mod = await loadWithFs({
      cgroup: "0::/machine.slice/libpod-3f2a.scope\n",
    });
    expect(mod.isContainer()).toBe(true);
  });

  it("is true when a container runtime appears in /proc/1/cgroup", async () => {
    const mod = await loadWithFs({
      cgroup: "0::/system.slice/containerd.service\n",
    });
    expect(mod.isContainer()).toBe(true);
  });

  it("is false for a host cgroup line", async () => {
    const mod = await loadWithFs({
      cgroup: "0::/user.slice/user-1000.slice\n",
    });
    expect(mod.isContainer()).toBe(false);
  });

  it("is false when neither signal is readable (macOS, or no /proc)", async () => {
    // Not a container as far as we know — and a false negative is the cheap
    // direction, since it only biases the fallback between two working stores.
    const mod = await loadWithFs({ cgroup: new Error("ENOENT") });
    expect(mod.isContainer()).toBe(false);
  });
});

describe("isOnMountPoint", () => {
  it("is false for an ordinary directory", () => {
    expect(isOnMountPoint(tmpDir)).toBe(false);
  });

  it("is false for a path that doesn't exist yet, walking to its parent", () => {
    // The first-run shape: `~/.mcp-inspector` has not been created. Answering
    // from the nearest existing ancestor is what keeps this from being a
    // missing-file error at startup.
    expect(isOnMountPoint(path.join(tmpDir, "nope", "deeper"))).toBe(false);
  });

  it("is false when the path itself can't be resolved", () => {
    // A NUL byte makes `path.resolve` throw. Any failure to answer the
    // question resolves to "not a mount", which keeps a container on the
    // conservative side — memory, which never promises what it can't keep.
    expect(isOnMountPoint("bad\0path")).toBe(false);
  });

  it("is false at the filesystem root", () => {
    // `/` is its own parent and is trivially a mount — reporting true there
    // would make every container look like it had a volume.
    expect(isOnMountPoint(path.parse(process.cwd()).root)).toBe(false);
  });
});

describe("isOnMountPoint via /proc/self/mountinfo", () => {
  /**
   * Load the module with a synthetic mount table, so the container layouts
   * that matter can be exercised on a developer's laptop. `existsSync` is
   * stubbed alongside it because the paths in these tables do not exist here.
   */
  async function loadWithMounts(mountinfo: string | null, existing: string[]) {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: (p: string) => existing.includes(p),
        readFileSync: (p: string, enc?: unknown) => {
          if (p === "/proc/self/mountinfo") {
            if (mountinfo === null) throw new Error("ENOENT");
            return mountinfo;
          }
          return actual.readFileSync(p, enc as never);
        },
      };
    });
    return import("@inspector/core/auth/node/secret-store-selection.js");
  }

  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  // Field 5 is the mount point; the rest is real mountinfo shape.
  const line = (point: string) =>
    `36 35 0:32 / ${point} rw,relatime - overlay overlay rw`;

  it("sees a directory that IS the mount point", async () => {
    const mod = await loadWithMounts(
      [line("/"), line("/home/node/.mcp-inspector")].join("\n"),
      ["/home/node/.mcp-inspector"],
    );
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(true);
  });

  it("sees a directory INSIDE a mounted volume", async () => {
    // The case a device-boundary test gets wrong: the volume is at
    // /home/node, so .mcp-inspector is an ordinary subdirectory sharing its
    // parent's device. Judging it unmounted demotes a durable setup to
    // session-only memory.
    const mod = await loadWithMounts(
      [line("/"), line("/home/node")].join("\n"),
      ["/home/node/.mcp-inspector"],
    );
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(true);
  });

  it("is false on the container's writable layer", async () => {
    // Only `/` is mounted, and `/` is deliberately excluded — it is the
    // writable layer this question exists to distinguish against.
    const mod = await loadWithMounts(line("/"), ["/home/node/.mcp-inspector"]);
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(false);
  });

  it("does not mistake a sibling prefix for a parent mount", async () => {
    // `/home/node-2` starts with `/home/node` as a string but is not under
    // it, which is why the check appends the separator.
    const mod = await loadWithMounts(
      [line("/"), line("/home/node")].join("\n"),
      ["/home/node-2/.mcp-inspector"],
    );
    expect(mod.isOnMountPoint("/home/node-2/.mcp-inspector")).toBe(false);
  });

  it("decodes a space-escaped mount point", async () => {
    const mod = await loadWithMounts(
      [line("/"), line("/mnt/my\\040volume")].join("\n"),
      ["/mnt/my volume/secrets"],
    );
    expect(mod.isOnMountPoint("/mnt/my volume/secrets")).toBe(true);
  });

  it("answers from the nearest existing ancestor, not the missing leaf", async () => {
    // First run: the secrets directory has not been created inside the
    // mounted volume yet.
    const mod = await loadWithMounts(
      [line("/"), line("/home/node")].join("\n"),
      ["/home/node"],
    );
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(true);
  });

  it("falls back to the device comparison where mountinfo is unreadable", async () => {
    // macOS, Windows, or a /proc-less container. The fallback compares
    // against `/` rather than the immediate parent, so a subdirectory of a
    // mount is still recognized — but a real path is needed for `stat`, so
    // this only asserts it does not throw and answers the ordinary case.
    const mod = await loadWithMounts(null, [tmpDir]);
    expect(mod.isOnMountPoint(tmpDir)).toBe(false);
  });
});

describe("warnAboutSecretStorage", () => {
  const base: SecretStorageInfo = {
    kind: "keyring",
    reason: "default",
    durable: true,
  };

  it("says nothing for the ordinary keychain case", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnAboutSecretStorage(base);
    expect(warn).not.toHaveBeenCalled();
  });

  it("announces a fallback with no cause to name", () => {
    // `detail` is optional — an explicitly configured store has no keychain
    // error behind it, and the banner must not print an empty error line.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnAboutSecretStorage({
      kind: "file",
      reason: "fallback",
      durable: true,
      path: "/x/secrets.json",
      plaintext: false,
    });
    const printed = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("fell back from the OS keychain");
    expect(printed).not.toContain("Keychain error:");
  });

  it("announces a fallback, names the cause, and points at the override", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnAboutSecretStorage({
      kind: "memory",
      reason: "fallback",
      durable: false,
      detail: "no D-Bus session",
    });
    const output = warn.mock.calls.flat().join("\n");
    expect(output).toContain("OS keychain is not available");
    expect(output).toContain("no D-Bus session");
    expect(output).toContain("MCP_INSPECTOR_SECRET_STORE");
    // The lossy-store caveat rides along — this is the "loud" half of
    // "automatic fallback with a loud banner".
    expect(output).toContain("lost on exit");
  });

  it("warns about an unencrypted file even when it was explicitly chosen", () => {
    // `reason: "configured"` means the user picked `file`; it does not mean
    // they knew it would be unencrypted.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnAboutSecretStorage({
      kind: "file",
      reason: "configured",
      durable: true,
      plaintext: true,
      path: "/tmp/secrets.json",
    });
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "MCP_INSPECTOR_SECRET_KEY",
    );
  });
});

describe("resolveSecretStore", () => {
  it("uses the keychain when the probe succeeds", async () => {
    const mod = await loadWithProbe(true);
    const { info } = await mod.resolveSecretStore();
    expect(info).toMatchObject({ kind: "keyring", reason: "default" });
  });

  it("caches the resolution so every consumer describes the same store", async () => {
    // The banner, `/api/config`, and the store doing the writing are three
    // readers of one decision; a re-probe that flipped would have the UI
    // naming a store nobody is using.
    const mod = await loadWithProbe(true);
    expect(await mod.resolveSecretStore()).toBe(await mod.resolveSecretStore());
  });

  it("falls back with a reason and a detail when the probe fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    const mod = await loadWithProbe(false, "Couldn't access platform storage");
    const { info, store } = await mod.resolveSecretStore();
    expect(info.reason).toBe("fallback");
    expect(info.detail).toContain("Couldn't access platform storage");
    // And the store it hands back actually works — the point of falling back.
    await store.set("alpha", "env:A", "1");
    expect(await store.get("alpha", "env:A")).toBe("1");
  });

  it("honors an explicit memory store without probing", async () => {
    process.env.MCP_INSPECTOR_SECRET_STORE = "memory";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const { info } = await mod.resolveSecretStore();
    expect(info).toMatchObject({
      kind: "memory",
      reason: "configured",
      durable: false,
    });
  });

  it("honors an explicit file store, reporting its path and encryption state", async () => {
    const target = path.join(tmpDir, "custom", "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    process.env.MCP_INSPECTOR_SECRET_FILE = target;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const { info } = await mod.resolveSecretStore();
    expect(info).toMatchObject({
      kind: "file",
      reason: "configured",
      path: target,
      plaintext: true,
      durable: true,
    });
  });

  it("reports an encrypted file when the passphrase is set", async () => {
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    const mod = await loadWithProbe(true);
    const { info } = await mod.resolveSecretStore();
    expect(info.plaintext).toBe(false);
  });

  it("getSecretStorageInfo returns the same descriptor as the resolution", async () => {
    const mod = await loadWithProbe(true);
    const { info } = await mod.resolveSecretStore();
    expect(await mod.getSecretStorageInfo()).toBe(info);
  });
});

describe("defaultSecretStore", () => {
  it("delegates every operation to the resolved store", async () => {
    // The deferred wrapper exists so the synchronous `?? defaultSecretStore()`
    // call sites keep working; if it stopped forwarding, secrets would vanish
    // into an object nobody reads.
    process.env.MCP_INSPECTOR_SECRET_STORE = "memory";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const store = mod.defaultSecretStore();

    await store.set("alpha", "env:A", "1");
    await store.set("alpha", "env:B", "2");
    await store.set("beta", "env:A", "3");
    expect(await store.get("alpha", "env:A")).toBe("1");

    await store.delete("alpha", "env:A");
    expect(await store.get("alpha", "env:A")).toBe(null);

    await store.deleteAllForServer("alpha");
    expect(await store.get("alpha", "env:B")).toBe(null);
    expect(await store.get("beta", "env:A")).toBe("3");

    // And it is the *same* underlying store the resolution reports.
    const { store: resolvedStore } = await mod.resolveSecretStore();
    expect(await resolvedStore.get("beta", "env:A")).toBe("3");
  });
});

describe("defaultSecretFilePath", () => {
  it("resolves a relative override to an absolute path", async () => {
    // The path is shown in the UI footer, so a relative one would be
    // ambiguous about which directory it is relative to.
    process.env.MCP_INSPECTOR_SECRET_FILE = "./rel/secrets.json";
    const mod = await loadWithProbe(true);
    expect(path.isAbsolute(mod.defaultSecretFilePath())).toBe(true);
  });

  it("defaults to ~/.mcp-inspector/secrets.json", async () => {
    const mod = await loadWithProbe(true);
    expect(mod.defaultSecretFilePath()).toContain(
      path.join(".mcp-inspector", "secrets.json"),
    );
  });

  it("follows MCP_STORAGE_DIR when no explicit file is named", async () => {
    // The variable that already relocates OAuth tokens and client.json. A
    // container mounting only that directory must not be judged unmounted and
    // demoted to `memory` — the user arranged for exactly this directory to
    // survive.
    process.env.MCP_STORAGE_DIR = tmpDir;
    const mod = await loadWithProbe(true);
    expect(mod.defaultSecretFilePath()).toBe(path.join(tmpDir, "secrets.json"));
  });

  it("lets an explicit MCP_INSPECTOR_SECRET_FILE outrank MCP_STORAGE_DIR", async () => {
    // Naming the file outright is the more specific statement of the two.
    process.env.MCP_STORAGE_DIR = tmpDir;
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "elsewhere.json");
    const mod = await loadWithProbe(true);
    expect(mod.defaultSecretFilePath()).toBe(
      path.join(tmpDir, "elsewhere.json"),
    );
  });
});

describe("DeferredSecretStore forwards the optional seams", () => {
  // This is what `defaultSecretStore()` returns, so a seam it drops is a
  // seam that does not exist in production — however well the tests that
  // inject a concrete store behave.
  it("forwards getStrict rather than degrading to the tolerant get", async () => {
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    const store = mod.defaultSecretStore();
    expect(typeof store.getStrict).toBe("function");

    const { secretStoreGetStrict } =
      await import("@inspector/core/auth/node/secret-store.js");
    // The file store's strict read is its ordinary read; the point here is
    // that the call reaches the target at all.
    expect(await secretStoreGetStrict(store, "srv", "env:A")).toBe(null);
    await store.set("srv", "env:A", "1");
    expect(await secretStoreGetStrict(store, "srv", "env:A")).toBe("1");
  });

  it("forwards getMany", async () => {
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    const store = mod.defaultSecretStore();
    await store.set("srv", "env:A", "1");
    await store.set("srv", "env:B", "2");

    const { secretStoreGetMany } =
      await import("@inspector/core/auth/node/secret-store.js");
    expect(await secretStoreGetMany(store, "srv", ["env:A", "env:B"])).toEqual({
      "env:A": "1",
      "env:B": "2",
    });
  });
});

describe("absorbFileSecretsIntoKeyring", () => {
  // The transition: a box without libsecret falls back to a file, the user
  // saves secrets there, then installs libsecret. Without a hand-off the next
  // run selects the keychain and every saved value silently disappears —
  // still on disk, but read by nothing.
  async function seedFile(secrets: Record<string, string>): Promise<string> {
    const filePath = path.join(tmpDir, "secrets.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, encryption: "none", secrets }),
      "utf-8",
    );
    return filePath;
  }

  it("moves the file's secrets into the keychain and removes the file", async () => {
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();

    await mod.absorbFileSecretsIntoKeyring(keyring);

    expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-file");
    expect(existsSync(filePath)).toBe(false);
  });

  it("lets the keychain win on conflict", async () => {
    // The file's copy is the older one by construction — it was written while
    // the keychain was unreachable.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();
    await keyring.set("srv", "oauthClientSecret", "already-here");

    await mod.absorbFileSecretsIntoKeyring(keyring);

    expect(await keyring.get("srv", "oauthClientSecret")).toBe("already-here");
  });

  it("leaves the file alone when the keychain write fails", async () => {
    // A partial hand-off must not delete the source: the next run retries and
    // the keychain-wins rule absorbs whatever already made it across.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const failing: SecretStore = {
      get: async () => null,
      set: async () => {
        throw new Error("keychain exploded");
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };

    await mod.absorbFileSecretsIntoKeyring(failing);

    expect(existsSync(filePath)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("left in place"));
  });

  it("does not delete a file it cannot read", async () => {
    // An undecryptable file is not an empty one. Deleting it here would lose
    // exactly the values this hand-off exists to preserve.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { FileSecretStore } =
      await import("@inspector/core/auth/node/file-secret-store.js");
    await new FileSecretStore({ filePath, passphrase: "right-key" }).set(
      "srv",
      "oauthClientSecret",
      "encrypted",
    );

    // The passphrase is gone by the time the keychain reappears.
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();
    await mod.absorbFileSecretsIntoKeyring(keyring);

    expect(existsSync(filePath)).toBe(true);
    expect(await keyring.get("srv", "oauthClientSecret")).toBe(null);
  });

  it("aborts rather than overwriting when the keychain read fails", async () => {
    // `get` answers null for an unreachable keychain as well as a missing
    // entry, and the hand-off *writes* on null — so a transient read failure
    // would replace a newer keychain value with the older file copy, exactly
    // inverting the keychain-wins rule. The strict read turns that into a
    // throw, which leaves the file in place for the next run.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    let wrote = false;
    const flaky: SecretStore = {
      get: async () => null,
      getStrict: async () => {
        throw new Error("keychain temporarily unavailable");
      },
      set: async () => {
        wrote = true;
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };

    await mod.absorbFileSecretsIntoKeyring(flaky);

    expect(wrote).toBe(false);
    expect(existsSync(filePath)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("left in place"));
  });

  it("uses the strict read when the store offers one", async () => {
    // And when it answers "present", the keychain still wins.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    let wrote = false;
    const store: SecretStore = {
      // Deliberately disagrees with `getStrict` so the test proves which one
      // the migration consults.
      get: async () => null,
      getStrict: async () => "already-here",
      set: async () => {
        wrote = true;
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };

    await mod.absorbFileSecretsIntoKeyring(store);

    expect(wrote).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  it("is a no-op for a file that holds no entries", async () => {
    // An empty map is not a hand-off. Deleting the file here would be
    // harmless but pointless; the interesting part is that it does not warn
    // about a migration that never happened.
    const filePath = await seedFile({});
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());
    expect(existsSync(filePath)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("copies what it can but keeps the file when an entry is unmigratable", async () => {
    // A hand-edited file can carry a key that is not `serverId:field`. It
    // cannot be addressed through the store API, so it cannot be copied —
    // which makes the hand-off incomplete, and an incomplete hand-off must
    // not delete its source. Removing the file anyway would discard that
    // value permanently in order to tidy up a migration that had failed.
    const filePath = await seedFile({
      "no-separator": "orphan",
      "srv:oauthClientSecret": "from-file",
    });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();

    await mod.absorbFileSecretsIntoKeyring(keyring);

    // The migratable entry is across...
    expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-file");
    // ...and the orphan still exists on disk rather than being dropped.
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(await fs.readFile(filePath, "utf-8"))).toMatchObject({
      secrets: { "no-separator": "orphan" },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("left in place so nothing is lost"),
    );
  });

  it("declines to delete a file that changed while the hand-off ran", async () => {
    // Read → copy → delete is no longer one transaction: the store dropped
    // its cross-process lock in favour of optimistic writes, so another
    // Inspector can complete a `set` between the read and the delete. That
    // entry has not been copied, so deleting the file would discard a write
    // that reported success. The hand-off re-reads immediately before the
    // delete and backs off when the contents moved.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    // Stand in for the other Inspector: write to the file *during* the copy,
    // which is exactly the window the old lock covered.
    const keyring = new InMemorySecretStore();
    const { FileSecretStore } =
      await import("@inspector/core/auth/node/file-secret-store.js");
    const original = keyring.set.bind(keyring);
    let intruded = false;
    keyring.set = async (id: string, field: string, value: string) => {
      await original(id, field, value);
      if (!intruded) {
        intruded = true;
        await new FileSecretStore({ filePath }).set("other", "env:LATE", "z");
      }
    };

    await mod.absorbFileSecretsIntoKeyring(keyring);

    // The file survives, and so does the entry that arrived late.
    expect(existsSync(filePath)).toBe(true);
    expect(
      await new FileSecretStore({ filePath }).get("other", "env:LATE"),
    ).toBe("z");
    expect(warn.mock.calls.flat().join("\n")).toMatch(
      /changed while that ran, so it has been left in place/,
    );
  });

  it("deletes the file when nothing changed under it", async () => {
    // The ordinary path: no concurrent writer, so the comparison matches and
    // the now-redundant file goes away.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    const keyring = new InMemorySecretStore();
    await mod.absorbFileSecretsIntoKeyring(keyring);

    expect(existsSync(filePath)).toBe(false);
    expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-file");
  });

  it("runs the hand-off for an explicitly configured keyring too", async () => {
    // `MCP_INSPECTOR_SECRET_STORE=keyring` reaches the keychain by a
    // different path than the probe does, and a leftover file is just as
    // invisible either way.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "keyring";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    // Resolving is what triggers it, via the configured branch.
    await mod.resolveSecretStore();
    expect(existsSync(filePath)).toBe(false);
  });

  it("is a no-op when there is no file", async () => {
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "absent.json");
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();
    await mod.absorbFileSecretsIntoKeyring(keyring);
    expect(existsSync(path.join(tmpDir, "absent.json"))).toBe(false);
  });
});

describe("the descriptor refuses to guess an unreadable file's encryption", () => {
  it("reports encryptionUnknown instead of falling back to the write policy", async () => {
    // With a passphrase configured, the old fallback claimed "File
    // (encrypted)" about a file whose envelope had never been parsed — and
    // which `set` was about to refuse rather than overwrite.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    await fs.writeFile(filePath, "{ not json", "utf-8");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadWithProbe(false);
    const info = await mod.getSecretStorageInfo();

    expect(info.encryptionUnknown).toBe("not valid JSON");
    // No half-answer left for a consumer to read a default out of.
    expect(info.plaintext).toBeUndefined();
    expect(info.pendingEncryption).toBeUndefined();

    const { secretStorageLabel, secretStorageCaveat, secretStorageTone } =
      await import("@inspector/core/auth/secret-storage-info.js");
    expect(secretStorageLabel(info)).toBe("File (unreadable)");
    expect(secretStorageTone(info)).toBe("warn");
    expect(secretStorageCaveat(info)).toMatch(/Saving a secret will fail/);
  });

  it("still uses the write policy when there is genuinely no file", async () => {
    // The control: `absent` is the one state where reporting the policy is
    // honest, because the first write really will create it that way.
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "none.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    const info = await mod.getSecretStorageInfo();
    expect(info.encryptionUnknown).toBeUndefined();
    expect(info.plaintext).toBe(false);
  });
});

describe("the descriptor reports a mode it could not verify", () => {
  it("carries permissionsUnknown when the file exists but cannot be inspected", async () => {
    // The third state. Without it an unverifiable mode fell into the same
    // branch as a verified 0600, and the footer claimed owner-only
    // permissions having read nothing.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, encryption: "none", secrets: {} }),
      "utf-8",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      const denied = Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
      return {
        ...actual,
        default: actual,
        stat: vi.fn(() => Promise.reject(denied)),
      };
    });
    vi.doMock("@inspector/core/auth/node/secret-store.js", async () => {
      const actual = await vi.importActual<
        typeof import("@inspector/core/auth/node/secret-store.js")
      >("@inspector/core/auth/node/secret-store.js");
      return {
        ...actual,
        probeKeyringAvailable: vi.fn(async () => ({ available: true })),
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/secret-store-selection.js");
      const info = await mod.getSecretStorageInfo();
      expect(info.permissionsUnknown).toBe("EACCES");
      expect(info.looseMode).toBeUndefined();
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("@inspector/core/auth/node/secret-store.js");
      vi.resetModules();
    }
  });
});

describe("the descriptor reports a mode it could not tighten", () => {
  it("carries looseMode into the descriptor, and the caveat states the mode", async () => {
    // Reaching this state at all requires the chmod to *fail*: as the file's
    // owner you cannot stage it, because `tightenSecretFilePermissions`
    // repairs a 0644 file to 0600 during selection and the descriptor then
    // correctly reports owner-only. It is only real for a file owned by
    // another user or on a read-only mount — hence the mocked chmod, which
    // is standing in for a privilege we cannot drop inside a test.
    //
    // The warning is asserted through the *caveat* path deliberately.
    // Selection used to warn here too, and that line was removed in round 7
    // for being encryption-blind and duplicating this one — so asserting the
    // caveat text is what keeps this test pinned to the surviving mechanism
    // rather than passing on whichever line happens to mention the mode.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, encryption: "none", secrets: {} }),
      "utf-8",
    );
    await fs.chmod(filePath, 0o644);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        default: actual,
        chmod: vi.fn(() =>
          Promise.reject(new Error("EPERM: operation not permitted")),
        ),
      };
    });
    vi.doMock("@inspector/core/auth/node/secret-store.js", async () => {
      const actual = await vi.importActual<
        typeof import("@inspector/core/auth/node/secret-store.js")
      >("@inspector/core/auth/node/secret-store.js");
      return {
        ...actual,
        probeKeyringAvailable: vi.fn(async () => ({ available: true })),
      };
    });
    try {
      const mod =
        await import("@inspector/core/auth/node/secret-store-selection.js");
      const info = await mod.getSecretStorageInfo();
      expect(info.looseMode).toBe(0o644);
      // The plaintext wording, in full: this file is unencrypted, so a
      // reader really does get the secrets.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "mode 0644, not 0600, and could not be tightened — anyone who can read it can read the secrets in it",
        ),
      );
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.doUnmock("@inspector/core/auth/node/secret-store.js");
      vi.resetModules();
    }
  });
});

describe("the descriptor reports the file, not the write policy", () => {
  it("says plaintext while a pre-existing plaintext file is only *going* to be encrypted", async () => {
    // The transitional state: the passphrase is set, so the next write will
    // encrypt, but the bytes on disk are still readable. Reporting "File
    // (encrypted)" here is the one false reassurance this subsystem exists to
    // avoid.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const plain = await loadWithProbe(false);
    await plain.defaultSecretStore().set("alpha", "env:A", "1");

    // Same file, now with a passphrase configured.
    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    const withKey = await loadWithProbe(false);
    const info = await withKey.getSecretStorageInfo();
    expect(info.plaintext).toBe(true);
    expect(info.pendingEncryption).toBe(true);

    // And the advice changes with it: telling someone to set a passphrase
    // they have already set is worse than saying nothing.
    const { secretStorageCaveat, secretStorageLabel } =
      await import("@inspector/core/auth/secret-storage-info.js");
    expect(secretStorageLabel(info)).toBe("File (unencrypted)");
    expect(secretStorageCaveat(info)).toMatch(/next time a secret is saved/);
  });

  it("says encrypted once the upgrading write has actually landed", async () => {
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const plain = await loadWithProbe(false);
    await plain.defaultSecretStore().set("alpha", "env:A", "1");

    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    const withKey = await loadWithProbe(false);
    await withKey.defaultSecretStore().set("alpha", "env:B", "2");

    const after = await loadWithProbe(false);
    const info = await after.getSecretStorageInfo();
    expect(info.plaintext).toBe(false);
    expect(info.pendingEncryption).toBeUndefined();
  });

  it("stops saying unencrypted once this process performs the upgrading write", async () => {
    // The staleness trap: the selection is cached for the process, so a
    // descriptor cached alongside it would keep serving "still unencrypted"
    // from `/api/config` for the rest of the session — describing bytes this
    // very process had just changed.
    const filePath = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const plain = await loadWithProbe(false);
    await plain.defaultSecretStore().set("alpha", "env:A", "1");

    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    const mod = await loadWithProbe(false);

    // Same module instance throughout — this is one running process.
    expect((await mod.getSecretStorageInfo()).plaintext).toBe(true);
    await mod.defaultSecretStore().set("alpha", "env:B", "2");
    const after = await mod.getSecretStorageInfo();
    expect(after.plaintext).toBe(false);
    expect(after.pendingEncryption).toBeUndefined();
  });

  it("keeps returning the same store while re-deriving the descriptor", async () => {
    // The selection itself must stay cached — the banner, /api/config, and
    // the store doing the writing have to agree on *which* store it is.
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    const first = await mod.resolveSecretStore();
    const second = await mod.resolveSecretStore();
    expect(second.store).toBe(first.store);
    expect((await mod.getSecretStorageInfo()).kind).toBe("file");
  });

  it("falls back to the write policy when there is no file yet", async () => {
    // Nothing on disk to describe, and the policy is then accurate: the first
    // write creates the file in exactly that mode.
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "absent.json");
    process.env.MCP_INSPECTOR_SECRET_STORE = "file";
    process.env.MCP_INSPECTOR_SECRET_KEY = "hunter2";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(false);
    const info = await mod.getSecretStorageInfo();
    expect(info.plaintext).toBe(false);
    expect(info.pendingEncryption).toBeUndefined();
  });
});
