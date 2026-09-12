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
  async function loadWithMounts(
    mountinfo: string | null,
    existing: string[],
    // Symlink targets, keyed by the link path. Absent entries resolve to
    // themselves, which is what a non-symlinked path does.
    links: Record<string, string> = {},
  ) {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: (p: string) => existing.includes(p),
        realpathSync: (p: string) => {
          if (!existing.includes(p)) throw new Error("ENOENT");
          return links[p] ?? p;
        },
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

  it("follows a symlink into a mounted volume", async () => {
    // Round 13: the comparison is a string prefix over a *lexical* path, so
    // `~/.mcp-inspector -> /data/inspector` with `/data` mounted matched no
    // mount point, read as the container's writable layer, and silently
    // selected the session-only store on a box that had arranged for
    // persistence — the failure being invisible is the whole problem.
    const mod = await loadWithMounts(
      line("/data"),
      ["/home/node/.mcp-inspector", "/data/inspector"],
      { "/home/node/.mcp-inspector": "/data/inspector" },
    );
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(true);
  });

  it("still answers lexically when the path cannot be resolved", async () => {
    // `realpathSync` throwing must not turn a mounted directory into an
    // unmounted one — the lexical answer is correct whenever no symlink is
    // involved, which is the overwhelming majority.
    const mod = await loadWithMounts(line("/data"), ["/data/inspector"], {});
    // `/data/inspector` exists but resolving it throws in this stub only for
    // paths outside `existing`; this asserts the ordinary path still works.
    expect(mod.isOnMountPoint("/data/inspector")).toBe(true);
  });

  it("does not call a tmpfs mount durable", async () => {
    // `docker run --tmpfs /home/node/.mcp-inspector` puts a real entry in
    // mountinfo, so believing the mount table alone selects the file store
    // and publishes `durable: true` for a file that disappears when the
    // container stops — the same false promise the memory fallback exists to
    // avoid, reached by trusting the wrong field.
    const mod = await loadWithMounts(
      "36 35 0:32 / /home/node/.mcp-inspector rw,relatime - tmpfs tmpfs rw",
      ["/home/node/.mcp-inspector"],
    );
    expect(mod.isOnMountPoint("/home/node/.mcp-inspector")).toBe(false);
  });

  it("does not call a ramfs mount durable either", async () => {
    const mod = await loadWithMounts(
      "36 35 0:32 / /data rw,relatime - ramfs ramfs rw",
      ["/data"],
    );
    expect(mod.isOnMountPoint("/data")).toBe(false);
  });

  it("reads the fstype after the optional-fields separator, not by position", async () => {
    // mountinfo carries a variable number of optional fields before ` - `,
    // so the type cannot be indexed positionally. This line has two.
    const mod = await loadWithMounts(
      "36 35 0:32 / /data rw,relatime shared:1 master:2 - ext4 /dev/sda1 rw",
      ["/data"],
    );
    expect(mod.isOnMountPoint("/data")).toBe(true);
  });

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

  it("is absolute even when HOME and USERPROFILE are both unset", async () => {
    // A service started with a minimal environment has neither, and the
    // `"."` fallback then yields a *relative* path — while
    // `FileSecretStoreOptions.filePath` and the `SecretStorageInfo.path` the
    // footer offers to copy both promise an absolute one. A copied location
    // that means nothing without knowing the process's cwd is not a location.
    const savedHome = process.env.HOME;
    const savedProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    try {
      const mod = await loadWithProbe(true);
      expect(path.isAbsolute(mod.defaultSecretFilePath())).toBe(true);
    } finally {
      if (savedHome !== undefined) process.env.HOME = savedHome;
      if (savedProfile !== undefined) process.env.USERPROFILE = savedProfile;
    }
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
    expect(
      await secretStoreGetMany(store, [
        { serverId: "srv", fields: ["env:A", "env:B"] },
      ]),
    ).toEqual({ srv: { "env:A": "1", "env:B": "2" } });
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

  it("does not throw when another process holds the lock (#2082)", async () => {
    // `withSecretFileLock` throws on a lock held past its retry budget, which
    // is right for a `set` — the user is waiting on that value — and wrong
    // here. This function is awaited directly by both `resolveSecretStore`
    // branches, so an escaping error fails store resolution and with it the
    // whole session: a stuck writer elsewhere on the box would stop the
    // Inspector from starting. Leaving the file for the next run is the only
    // acceptable outcome.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    const properLockfile = (await import("proper-lockfile")).default;
    const release = await properLockfile.lock(filePath, {
      realpath: false,
      stale: 10_000,
    });

    await expect(
      mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore()),
    ).resolves.toBeUndefined();
    await release();

    // Left exactly as it was, and said so — asserting the *lock* message
    // specifically, since the pre-existing claim-failure warning also ends in
    // "left in place" and would let this pass without the lock ever being hit.
    expect(existsSync(filePath)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not lock the secrets file"),
    );
    // Past the integration project's own 30s deliberately, and one of the few
    // sites that should be (#2323): this test waits on a second process holding
    // the secrets-file lock until `proper-lockfile` gives up on it, which is
    // real elapsed contention rather than slack for a loaded machine.
  }, 60_000);

  it("takes no lock when there is nothing to migrate (#2082)", async () => {
    // The overwhelmingly common startup: a keychain is available and no file
    // was ever written. Locking first would create and remove a lock
    // directory on every run — and on a box whose storage directory does not
    // exist yet the lock cannot be created at all, so the degrade path would
    // warn about unprotected writes on every single run, with nothing to
    // protect.
    const filePath = path.join(tmpDir, "no-such-dir", "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());

    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(`${filePath}.lock`)).toBe(false);
  });

  it("treats ENOTDIR as the fresh-install case, like ENOENT (#2082)", async () => {
    // A path whose parent is a *file* answers `readdir` with ENOTDIR — the
    // other shape of "there is no directory here" — so it takes the same
    // silent path as a missing one. The *unlistable* case is different and is
    // covered by the test below.
    await fs.writeFile(path.join(tmpDir, "not-a-dir"), "", "utf-8");
    const filePath = path.join(tmpDir, "not-a-dir", "secrets.json");
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());

    // ENOTDIR is a fresh-install shape: nothing said, nothing locked.
    expect(warn).not.toHaveBeenCalled();
  });

  // Root bypasses POSIX permission checks, and Windows does not model them
  // the same way — in either case the directory below stays listable and the
  // test would assert nothing.
  const canDenyListing =
    process.platform !== "win32" && process.getuid?.() !== 0;

  it.skipIf(!canDenyListing)(
    "does not treat an unlistable directory as an empty one (#2082)",
    async () => {
      // The case ENOTDIR does *not* cover, and the reason the catch narrowed
      // to ENOENT/ENOTDIR rather than swallowing everything. A directory with
      // `--x` permission denies `readdir` with EACCES while still permitting
      // access to a *known* name inside it — so reading EACCES as "nothing to
      // migrate" selects the keychain and leaves those secrets invisible with
      // nothing said. That asymmetry is real POSIX behaviour, which is why
      // this drives it with a real mode rather than a stubbed `readdir`.
      const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
      process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      // Write + execute, no read: `readdir` fails, `stat`/`open`/`rename` of a
      // known name still work — which is exactly what the migration needs.
      await fs.chmod(tmpDir, 0o300);
      try {
        const mod = await loadWithProbe(true);
        const keyring = new InMemorySecretStore();
        await mod.absorbFileSecretsIntoKeyring(keyring);

        // It went on and migrated, rather than silently skipping.
        expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-file");
      } finally {
        // Restore before `afterEach`, which needs to list it to remove it.
        await fs.chmod(tmpDir, 0o700);
      }
    },
  );

  it("does not adopt a snapshot another migration is still using (#2082)", async () => {
    // A `*.migrating-*` file is not automatically an orphan: the process that
    // staged it may still be reading it. Adopting one mid-hand-off links it
    // back to the live path and re-claims it under a new name, so its owner's
    // hand-off fails ENOENT — and if we exit before copying, that healthy
    // session starts with none of those secrets.
    //
    // Liveness is the snapshot's own lock rather than the pid in its name: a
    // pid outlives its process and recurs (pid 1 on every container start),
    // whereas the lock expires by itself if the owner dies.
    const inProgress = path.join(tmpDir, "secrets.json.migrating-999-abc");
    await fs.writeFile(
      inProgress,
      JSON.stringify({
        version: 1,
        encryption: "none",
        secrets: { "srv:oauthClientSecret": "still-migrating" },
      }),
      "utf-8",
    );
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const properLockfile = (await import("proper-lockfile")).default;
    const release = await properLockfile.lock(inProgress, {
      realpath: false,
      stale: 10_000,
    });

    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();
    await mod.absorbFileSecretsIntoKeyring(keyring);
    await release();

    // Left exactly where its owner put it, and not migrated from under it.
    expect(existsSync(inProgress)).toBe(true);
    expect(existsSync(path.join(tmpDir, "secrets.json"))).toBe(false);
    expect(await keyring.get("srv", "oauthClientSecret")).toBe(null);
  });

  it("ignores a snapshot's own lock directory (#2082)", async () => {
    // `secrets.json.migrating-<pid>-<uuid>.lock` matches the plain prefix
    // test, and treating it as a snapshot is self-sustaining damage: the
    // liveness probe asks about a nonexistent `<name>.lock.lock` and answers
    // "not held", recovery tries to hard-link a *directory* onto the secrets
    // path, fails, and prints the orphan warning — every startup, forever,
    // since a liveness *check* never clears a stale lock directory.
    const strayLock = path.join(tmpDir, "secrets.json.migrating-999-abc.lock");
    await fs.mkdir(strayLock);
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());

    // Not mistaken for a snapshot: nothing said, nothing linked, and the
    // directory left exactly where it was.
    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(strayLock)).toBe(true);
    expect(existsSync(path.join(tmpDir, "secrets.json"))).toBe(false);
  });

  it("still adopts an orphan when the live file is absent (#2082)", async () => {
    // The fast path above must not be a `stat` of `secrets.json`: an
    // interrupted migration leaves *only* the snapshot, which is precisely
    // the case where there is everything to migrate and no live file.
    const orphan = path.join(tmpDir, "secrets.json.migrating-123-abc");
    await fs.writeFile(
      orphan,
      JSON.stringify({
        version: 1,
        encryption: "none",
        secrets: { "srv:oauthClientSecret": "from-orphan" },
      }),
      "utf-8",
    );
    process.env.MCP_INSPECTOR_SECRET_FILE = path.join(tmpDir, "secrets.json");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const keyring = new InMemorySecretStore();

    await mod.absorbFileSecretsIntoKeyring(keyring);

    expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-orphan");
    expect(existsSync(orphan)).toBe(false);
  });

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

  it("reports a claim that fails for a reason other than a lost race", async () => {
    // ENOENT means someone else claimed it. Anything else — EACCES, EROFS —
    // leaves the file where it is, and returning quietly would select the
    // keychain while file-backed secrets sit there invisible to everything,
    // with nothing said.
    const filePath = await seedFile({ "srv:oauthClientSecret": "stuck" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mocked before the module loads: it captures its `fs` binding at import,
    // so spying on the namespace afterwards does not reach it.
    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        default: actual,
        rename: async (from: string, to: string) => {
          if (String(to).includes(".migrating-")) {
            throw Object.assign(new Error("read-only file system"), {
              code: "EROFS",
            });
          }
          return actual.rename(from, to);
        },
      };
    });
    try {
      const mod = await loadWithProbe(true);
      await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());
      expect(existsSync(filePath)).toBe(true);
      expect(warn.mock.calls.flat().join("\n")).toMatch(
        /Could not claim the secrets file .*EROFS/,
      );
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });

  it("deferred store forwards isDurable and setMany to the resolved store", async () => {
    // Both are optional seams, and an unforwarded one degrades silently — the
    // exact defect that made `getStrict` inert in production for two rounds.
    process.env.MCP_INSPECTOR_SECRET_STORE = "memory";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);
    const store = mod.defaultSecretStore();

    // The memory store reports itself session-scoped; a store that dropped
    // the call would answer the `true` default instead.
    expect(await store.isDurable?.()).toBe(false);

    await store.setMany?.("srv", { "env:A": "1", "env:B": "2" });
    expect(await store.get("srv", "env:A")).toBe("1");
    expect(await store.get("srv", "env:B")).toBe("2");
  });

  it("recovers a snapshot left by a process that died mid-migration", async () => {
    // The claim protects the delete, and introduced a way to lose everything:
    // a crash between the rename and the copy leaves only
    // `secrets.json.migrating-<pid>`, and checking the canonical path alone
    // then reports "nothing to migrate" while every stored credential
    // silently disappears.
    const filePath = await seedFile({ "srv:oauthClientSecret": "orphaned" });
    const orphan = `${filePath}.migrating-999999`;
    await fs.rename(filePath, orphan);
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    const keyring = new InMemorySecretStore();
    await mod.absorbFileSecretsIntoKeyring(keyring);

    // Adopted and migrated, not abandoned.
    expect(await keyring.get("srv", "oauthClientSecret")).toBe("orphaned");
    expect(existsSync(orphan)).toBe(false);
  });

  it("leaves an orphan alone when a live secrets file already exists", async () => {
    // The live file is newer than any orphan and must not be replaced. The
    // orphan may hold values it does not, so it is reported rather than
    // removed — deciding a merge is not this function's job.
    const filePath = await seedFile({ "srv:oauthClientSecret": "current" });
    const orphan = `${filePath}.migrating-999999`;
    await fs.copyFile(filePath, orphan);
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    await mod.absorbFileSecretsIntoKeyring(new InMemorySecretStore());

    expect(existsSync(orphan)).toBe(true);
    expect(warn.mock.calls.flat().join("\n")).toMatch(
      /interrupted migration at .*migrating-999999/,
    );
  });

  it("claims the file atomically, so a later write is not deleted", async () => {
    // Round 19: the pre-delete comparison was a check-to-delete race. A
    // writer completing a `set` *after* the comparison and before the `rm`
    // had its write verified, reported success, and then lost it — a later,
    // already-successful write destroyed, which is worse than the
    // optimistic-write residual and, unlike that one, fixable.
    //
    // The file is now claimed by an atomic rename before anything reads it,
    // so a writer that recreates `secrets.json` afterwards is untouched: its
    // file is a different one and the next run migrates it.
    const filePath = await seedFile({ "srv:oauthClientSecret": "from-file" });
    process.env.MCP_INSPECTOR_SECRET_FILE = filePath;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await loadWithProbe(true);

    const keyring = new InMemorySecretStore();
    const { FileSecretStore } =
      await import("@inspector/core/auth/node/file-secret-store.js");
    // Stand in for the other Inspector: write to the live path *during* the
    // copy — i.e. after the claim, in the window the old comparison missed.
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

    // The late write survives at the live path...
    expect(existsSync(filePath)).toBe(true);
    expect(
      await new FileSecretStore({ filePath }).get("other", "env:LATE"),
    ).toBe("z");
    // ...the migrated values reached the keychain...
    expect(await keyring.get("srv", "oauthClientSecret")).toBe("from-file");
    // ...and no staging file is left behind.
    const leftovers = (await fs.readdir(path.dirname(filePath))).filter((f) =>
      f.includes(".migrating-"),
    );
    expect(leftovers).toEqual([]);
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
