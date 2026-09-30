import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  InMemorySecretStore,
  SessionSecretStore,
  KeychainUnavailableError,
  SECRET_FIELD_IDP_CLIENT_SECRET,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import { CLIENT_KEYCHAIN_ID } from "@inspector/core/client/secrets.js";
import {
  deleteClientConfigStore,
  readClientConfigStore,
  writeClientConfigStore,
} from "@inspector/core/client/node-persistence.js";

const configWithPlaintextSecret = {
  enterpriseManagedAuth: {
    idp: {
      issuer: "https://idp.example.com",
      clientId: "cid",
      clientSecret: "plain",
    },
  },
};

describe("client node-persistence", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function makeTmpFile(contents?: string): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-persist-"));
    const filePath = path.join(tmpDir, "client.json");
    if (contents !== undefined) {
      await fs.writeFile(filePath, contents, "utf-8");
    }
    return filePath;
  }

  it("migrates a plaintext secret to an empty keychain and strips it from disk", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    const secretStore = new InMemorySecretStore();

    const loaded = await readClientConfigStore(filePath, secretStore);

    // Rehydrated result still carries the secret (read back from the keychain).
    expect(loaded.enterpriseManagedAuth?.idp.clientSecret).toBe("plain");
    // On-disk copy is stripped.
    expect(readFileSync(filePath, "utf-8")).not.toContain("plain");
    // Keychain now holds it.
    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("plain");
  });

  it("aborts rather than overwriting when the keychain read fails", async () => {
    // The keychain-wins lookup used the tolerant `get`, which maps an
    // unreadable store to `null` — and the branch below writes on `null`. So
    // a transient read failure let the older client.json copy overwrite a
    // newer stored secret, and the disk copy was then stripped.
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    let wrote = false;
    const flaky: SecretStore = {
      get: async () => null,
      getStrict: async () => {
        throw new KeychainUnavailableError(new Error("temporarily down"));
      },
      set: async () => {
        wrote = true;
      },
      delete: async () => {},
      deleteAllForServer: async () => {},
    };

    const loaded = await readClientConfigStore(filePath, flaky);

    expect(wrote).toBe(false);
    // The plaintext survives for the next attempt.
    expect(readFileSync(filePath, "utf-8")).toContain("plain");
    expect(loaded.enterpriseManagedAuth?.idp.clientSecret).toBe("plain");
  });

  it("keeps the plaintext on disk when the store is session-scoped", async () => {
    // The container fallback. Migrating here would delete a secret that
    // survives restarts and keep only a copy that dies with the process —
    // and it happens on an ordinary read, so merely loading the app would
    // do it. The session still works: the value is loaded into the store.
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    const secretStore = new SessionSecretStore();

    const loaded = await readClientConfigStore(filePath, secretStore);

    expect(loaded.enterpriseManagedAuth?.idp.clientSecret).toBe("plain");
    // The disk copy is deliberately left alone.
    expect(readFileSync(filePath, "utf-8")).toContain("plain");
  });

  it("does not overwrite an existing keychain secret during migration", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      "existing",
    );

    const loaded = await readClientConfigStore(filePath, secretStore);

    // The keychain value wins over the disk plaintext.
    expect(loaded.enterpriseManagedAuth?.idp.clientSecret).toBe("existing");
    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("existing");
    // Disk is still stripped.
    expect(readFileSync(filePath, "utf-8")).not.toContain("plain");
  });

  it("keeps the plaintext secret on disk when the keychain is unavailable", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    // A store whose writes always fail as if libsecret were missing.
    const unavailable: SecretStore = {
      async get() {
        return null;
      },
      async set() {
        throw new KeychainUnavailableError(new Error("no libsecret"));
      },
      async delete() {},
      async deleteAllForServer() {},
    };

    const loaded = await readClientConfigStore(filePath, unavailable);

    // Migration bailed → original config (with the secret) is returned and the
    // on-disk copy is left untouched (still contains the plaintext).
    expect(loaded.enterpriseManagedAuth?.idp.clientSecret).toBe("plain");
    expect(readFileSync(filePath, "utf-8")).toContain("plain");
  });

  it("rethrows a non-keychain error raised during migration", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify(configWithPlaintextSecret),
    );
    const boom: SecretStore = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("disk on fire");
      },
      async delete() {},
      async deleteAllForServer() {},
    };

    await expect(readClientConfigStore(filePath, boom)).rejects.toThrow(
      /disk on fire/,
    );
  });

  it("returns {} when the client.json file is absent", async () => {
    const filePath = await makeTmpFile();
    expect(
      await readClientConfigStore(filePath, new InMemorySecretStore()),
    ).toEqual({});
  });

  it("deletes the keychain secret when writing a config without one", async () => {
    const filePath = await makeTmpFile();
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      "stale",
    );

    await writeClientConfigStore(
      filePath,
      {
        cimd: { enabled: true, clientMetadataUrl: "https://x.example/c.json" },
      },
      secretStore,
    );

    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBeNull();
    expect(readFileSync(filePath, "utf-8")).toContain("clientMetadataUrl");
  });

  it("deleteClientConfigStore removes both the file and the keychain secret", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      "gone",
    );

    await deleteClientConfigStore(filePath, secretStore);

    expect(existsSync(filePath)).toBe(false);
    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBeNull();
  });

  it("restores the prior keychain secret when the client.json write fails", async () => {
    // Set/delete happens before the file write; without compensation a
    // failed write would leave the new secret paired with the old on-disk
    // config. Force the write to fail by making the directory read-only.
    const filePath = await makeTmpFile(
      JSON.stringify({
        enterpriseManagedAuth: {
          idp: { issuer: "https://idp.example.com", clientId: "cid" },
        },
      }),
    );
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      "old-secret",
    );

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        writeClientConfigStore(
          filePath,
          {
            enterpriseManagedAuth: {
              idp: {
                issuer: "https://idp.example.com",
                clientId: "cid",
                clientSecret: "new-secret",
              },
            },
          },
          secretStore,
        ),
      ).rejects.toThrow();
    } finally {
      await fs.chmod(tmpDir, 0o755);
    }

    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("old-secret");
  });

  it("restores a cleared keychain secret when the client.json write fails", async () => {
    const filePath = await makeTmpFile(
      JSON.stringify({
        enterpriseManagedAuth: {
          idp: { issuer: "https://idp.example.com", clientId: "cid" },
        },
      }),
    );
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      "old-secret",
    );

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        writeClientConfigStore(
          filePath,
          {
            cimd: {
              enabled: true,
              clientMetadataUrl: "https://x.example/c.json",
            },
          },
          secretStore,
        ),
      ).rejects.toThrow();
    } finally {
      await fs.chmod(tmpDir, 0o755);
    }

    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("old-secret");
  });

  it("warns but rethrows the write failure when the restore itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = await makeTmpFile(
      JSON.stringify({
        enterpriseManagedAuth: {
          idp: { issuer: "https://idp.example.com", clientId: "cid" },
        },
      }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "old");
    let sets = 0;
    const failingRestore: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: async (id, f, v) => {
        sets += 1;
        // First set is the write itself; the second is the restore.
        if (sets > 1) throw new KeychainUnavailableError(new Error("gone"));
        return store.set(id, f, v);
      },
      delete: (id, f) => store.delete(id, f),
      deleteAllForServer: (id) => store.deleteAllForServer(id),
    };

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        writeClientConfigStore(
          filePath,
          {
            enterpriseManagedAuth: {
              idp: {
                issuer: "https://idp.example.com",
                clientId: "cid",
                clientSecret: "new",
              },
            },
          },
          failingRestore,
        ),
      ).rejects.toThrow(/EACCES|EPERM|permission/i);
    } finally {
      await fs.chmod(tmpDir, 0o755);
      warn.mockRestore();
    }
  });

  it("stringifies a non-Error restore failure in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = await makeTmpFile(
      JSON.stringify({
        enterpriseManagedAuth: {
          idp: { issuer: "https://idp.example.com", clientId: "cid" },
        },
      }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "old");
    let sets = 0;
    const failingRestore: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: async (id, f, v) => {
        sets += 1;
        if (sets > 1) throw "gone"; // deliberately a bare string
        return store.set(id, f, v);
      },
      delete: (id, f) => store.delete(id, f),
      deleteAllForServer: (id) => store.deleteAllForServer(id),
    };

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        writeClientConfigStore(
          filePath,
          {
            enterpriseManagedAuth: {
              idp: {
                issuer: "https://idp.example.com",
                clientId: "cid",
                clientSecret: "new",
              },
            },
          },
          failingRestore,
        ),
      ).rejects.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("gone"));
    } finally {
      await fs.chmod(tmpDir, 0o755);
      warn.mockRestore();
    }
  });

  it("deleteClientConfigStore keeps the file when the keychain delete fails", async () => {
    // Keychain-first ordering: a failed confirmed delete leaves the file
    // (and thus the visible config) untouched, so a retry sees the same
    // state instead of a config that looks deleted while its secret lives.
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "v");
    const failingDelete: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: (id, f, v) => store.set(id, f, v),
      delete: async () => {
        throw new KeychainUnavailableError(new Error("locked"));
      },
      deleteAllForServer: async () => {
        throw new KeychainUnavailableError(new Error("locked"));
      },
    };

    await expect(
      deleteClientConfigStore(filePath, failingDelete),
    ).rejects.toThrow();
    expect(existsSync(filePath)).toBe(true);
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("v");
  });

  it("deleteClientConfigStore restores the secret when the delete removes it and then fails", async () => {
    // The confirmed-delete contract only promises that a *resolved* delete
    // removed the value — a rejected one may have removed it first. The
    // compensation must therefore cover the delete itself, not just the
    // unlink, or the surviving config loses its indexed secret.
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "v");
    const partialDelete: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: (id, f, v) => store.set(id, f, v),
      delete: async (id, f) => {
        await store.delete(id, f);
        throw new KeychainUnavailableError(new Error("locked"));
      },
      deleteAllForServer: async () => {
        throw new KeychainUnavailableError(new Error("locked"));
      },
    };

    await expect(
      deleteClientConfigStore(filePath, partialDelete),
    ).rejects.toThrow();
    expect(existsSync(filePath)).toBe(true);
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("v");
  });

  it("deleteClientConfigStore restores the secret when the file unlink fails", async () => {
    // The other half of all-or-nothing: the secret delete succeeded but the
    // unlink did not — without the restore, the surviving client.json would
    // reload without its credential.
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "v");

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(deleteClientConfigStore(filePath, store)).rejects.toThrow();
    } finally {
      await fs.chmod(tmpDir, 0o755);
    }

    expect(existsSync(filePath)).toBe(true);
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("v");
  });

  it("delete: warns but rethrows the unlink failure when the restore fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "v");
    const failingRestore: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: async () => {
        throw new KeychainUnavailableError(new Error("gone"));
      },
      delete: (id, f) => store.delete(id, f),
      deleteAllForServer: (id) => store.deleteAllForServer(id),
    };

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        deleteClientConfigStore(filePath, failingRestore),
      ).rejects.toThrow(/EACCES|EPERM|permission/i);
    } finally {
      await fs.chmod(tmpDir, 0o755);
      warn.mockRestore();
    }
    expect(existsSync(filePath)).toBe(true);
  });

  it("delete: stringifies a non-Error restore failure in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = await makeTmpFile(
      JSON.stringify({ cimd: { enabled: false, clientMetadataUrl: "" } }),
    );
    const store = new InMemorySecretStore();
    await store.set(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET, "v");
    const failingRestore: SecretStore = {
      get: (id, f) => store.get(id, f),
      set: async () => {
        throw "gone"; // deliberately a bare string
      },
      delete: (id, f) => store.delete(id, f),
      deleteAllForServer: (id) => store.deleteAllForServer(id),
    };

    await fs.chmod(tmpDir, 0o555);
    try {
      await expect(
        deleteClientConfigStore(filePath, failingRestore),
      ).rejects.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("gone"));
    } finally {
      await fs.chmod(tmpDir, 0o755);
      warn.mockRestore();
    }
  });
});

describe("session-scoped store keeps client.json durable (#1950 review r19)", () => {
  it("does not strip the IdP secret when the store cannot outlive the process", async () => {
    // The read-path migration already withheld its strip for a session
    // store, but the write path did not — and `readClientConfigStore` hands
    // the rehydrated secret to the form, which resends the whole object when
    // an unrelated field changes. Saving a CIMD URL therefore moved the only
    // durable copy into RAM, to be lost at exit.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-durable-"));
    const file = path.join(dir, "client.json");
    try {
      // Legacy state: the secret is *already* on disk in plaintext, which is
      // what the durability guard exists to preserve.
      await fs.writeFile(
        file,
        JSON.stringify({
          enterpriseManagedAuth: {
            enabled: true,
            idp: {
              issuer: "https://idp.example/",
              clientId: "cid",
              clientSecret: "must-survive",
            },
          },
        }),
        "utf-8",
      );
      await writeClientConfigStore(
        file,
        {
          enterpriseManagedAuth: {
            enabled: true,
            idp: {
              issuer: "https://idp.example/",
              clientId: "cid",
              clientSecret: "must-survive",
            },
          },
        },
        new SessionSecretStore(),
      );
      expect(await fs.readFile(file, "utf-8")).toContain("must-survive");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write a newly entered IdP secret to disk on a session store", async () => {
    // Same overshoot as the server path: preserving *legacy* plaintext is
    // right, treating every submitted value as legacy is not — it would put a
    // freshly typed secret in `client.json` while the footer says a session
    // store writes secrets nowhere.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-fresh-"));
    const file = path.join(dir, "client.json");
    try {
      await writeClientConfigStore(
        file,
        {
          enterpriseManagedAuth: {
            enabled: true,
            idp: {
              issuer: "https://idp.example/",
              clientId: "cid",
              clientSecret: "never-typed-before",
            },
          },
        },
        new SessionSecretStore(),
      );
      expect(await fs.readFile(file, "utf-8")).not.toContain(
        "never-typed-before",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a new secret off disk when the prior file is unreadable", async () => {
    // Provenance cannot be established from a file that will not parse, and
    // the conservative direction is to treat the value as new — writing a
    // secret to disk on a guess is the failure that matters.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-bad-"));
    const file = path.join(dir, "client.json");
    try {
      await fs.writeFile(file, "{ not json", "utf-8");
      await writeClientConfigStore(
        file,
        {
          enterpriseManagedAuth: {
            enabled: true,
            idp: {
              issuer: "https://idp.example/",
              clientId: "cid",
              clientSecret: "unprovenanced",
            },
          },
        },
        new SessionSecretStore(),
      );
      expect(await fs.readFile(file, "utf-8")).not.toContain("unprovenanced");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing extra when a session store has no IdP secret at all", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-none-"));
    const file = path.join(dir, "client.json");
    try {
      await writeClientConfigStore(
        file,
        { cimd: { enabled: true, clientMetadataUrl: "https://x.test/cimd" } },
        new SessionSecretStore(),
      );
      expect(await fs.readFile(file, "utf-8")).toContain("cimd");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("still strips against a durable store, so the guard is the difference", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-durable-"));
    const file = path.join(dir, "client.json");
    try {
      await writeClientConfigStore(
        file,
        {
          enterpriseManagedAuth: {
            enabled: true,
            idp: {
              issuer: "https://idp.example/",
              clientId: "cid",
              clientSecret: "goes-to-the-store",
            },
          },
        },
        new InMemorySecretStore(),
      );
      expect(await fs.readFile(file, "utf-8")).not.toContain(
        "goes-to-the-store",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("client.json writers are serialized per resolved path", () => {
  // The compensated snapshot/mutate/write blocks are only sound one at a
  // time: two unserialized writers both snapshot the same prior secret, and
  // the loser's compensation then overwrites the winner's *committed* value
  // with the stale snapshot, leaving client.json describing one client while
  // the keychain holds another's secret. The file lock (`withSecretFileLock`,
  // the same exclusion oauth.json's writers take) makes the whole block a
  // critical section; this test drives the exact interleaving the lock
  // exists to close.
  it("a failed save's compensation cannot clobber a concurrent save's committed secret", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-serialize-"));
    const file = path.join(dir, "client.json");
    try {
      await fs.writeFile(
        file,
        JSON.stringify({
          enterpriseManagedAuth: {
            idp: { issuer: "https://idp.example/", clientId: "cid-old" },
          },
        }),
        "utf-8",
      );
      const store = new InMemorySecretStore();
      await store.set(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
        "old",
      );

      // Writer A parks inside its critical section — after its snapshot,
      // mid-`set` — until released, then fails, so its compensation restores
      // the snapshot. Writer B, started while A is parked, saves a new
      // secret and succeeds.
      let releaseA!: () => void;
      const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aReachedSet!: () => void;
      const aInsideSet = new Promise<void>((resolve) => {
        aReachedSet = resolve;
      });
      const gated: SecretStore = {
        get: (serverId, field) => store.get(serverId, field),
        set: async (serverId, field, value) => {
          if (value === "secret-a") {
            aReachedSet();
            await gateA;
            throw new Error("keychain rejected the write");
          }
          return store.set(serverId, field, value);
        },
        delete: (serverId, field) => store.delete(serverId, field),
        deleteAllForServer: (serverId) => store.deleteAllForServer(serverId),
      };

      const configFor = (suffix: string) => ({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.example/",
            clientId: `cid-${suffix}`,
            clientSecret: `secret-${suffix}`,
          },
        },
      });

      const saveA = writeClientConfigStore(file, configFor("a"), gated);
      const rejectedA = saveA.catch((err: unknown) => err);
      await aInsideSet; // A holds the lock, parked mid-mutation.
      const saveB = writeClientConfigStore(file, configFor("b"), store);
      // Give B time to run: under the lock it is parked at acquisition;
      // without the lock it would commit here, exposing its secret to A's
      // stale compensation below.
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseA();
      expect(await rejectedA).toBeInstanceOf(Error);
      await saveB;

      // B's committed state survives A's compensation: the store holds B's
      // secret and the file names B's client — the two halves agree.
      expect(
        await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
      ).toBe("secret-b");
      const onDisk = JSON.parse(await fs.readFile(file, "utf-8")) as {
        enterpriseManagedAuth: { idp: { clientId: string } };
      };
      expect(onDisk.enterpriseManagedAuth.idp.clientId).toBe("cid-b");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("withClientConfigLock failure paths", () => {
  // These force the lock seam itself to fail, which needs the module graph
  // rebuilt around a mocked `file-lock` — class identities (for the
  // `instanceof SecretFileLockHeldError` checks) must come from the same
  // fresh graph, so everything is imported after `vi.doMock`.
  let dir: string;
  let file: string;

  async function freshWithLock(
    impl: (filePath: string, fn: () => Promise<unknown>) => Promise<unknown>,
  ) {
    vi.resetModules();
    vi.doMock("@inspector/core/auth/node/file-lock.js", () => ({
      withSecretFileLock: impl,
    }));
    const persistence =
      await import("@inspector/core/client/node-persistence.js");
    const stores = await import("@inspector/core/auth/node/secret-store.js");
    return { persistence, stores };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "client-lockfail-"));
    file = path.join(dir, "client.json");
  });

  afterEach(async () => {
    vi.doUnmock("@inspector/core/auth/node/file-lock.js");
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rewords a held lock at acquisition to name client.json, keeping type and cause", async () => {
    const { persistence, stores } = await freshWithLock(async () => {
      throw new stores.SecretFileLockHeldError("Could not lock");
    });
    const rejection = persistence.writeClientConfigStore(
      file,
      {
        enterpriseManagedAuth: {
          idp: { issuer: "https://idp.example.com", clientId: "c" },
        },
      },
      new stores.InMemorySecretStore(),
    );
    await expect(rejection).rejects.toMatchObject({
      message: expect.stringContaining(
        `Could not save the client configuration: the file at ${file} is locked`,
      ),
    });
    // The subclass survives the rewording — it is what the HTTP layer maps
    // to a retryable 503; a plain Error would demote it to a 500.
    await expect(rejection).rejects.toBeInstanceOf(
      stores.SecretFileLockHeldError,
    );
    await expect(
      persistence.deleteClientConfigStore(
        file,
        new stores.InMemorySecretStore(),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Could not remove the client configuration",
      ),
    });
  });

  it("a held lock skips the read-path migration but keeps the read available", async () => {
    await fs.writeFile(file, JSON.stringify(configWithPlaintextSecret));
    const { persistence, stores } = await freshWithLock(async () => {
      throw new stores.SecretFileLockHeldError("Could not lock");
    });
    const store = new stores.InMemorySecretStore();
    const config = await persistence.readClientConfigStore(file, store);
    // The unlocked read's config is served untouched; nothing migrated.
    expect(
      (config as typeof configWithPlaintextSecret).enterpriseManagedAuth.idp
        .clientSecret,
    ).toBe("plain");
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBeNull();
    expect(JSON.parse(await fs.readFile(file, "utf-8"))).toEqual(
      configWithPlaintextSecret,
    );
  });

  it("a non-lock acquisition failure propagates untouched", async () => {
    await fs.writeFile(file, JSON.stringify(configWithPlaintextSecret));
    const original = new Error("disk exploded");
    const { persistence, stores } = await freshWithLock(async () => {
      throw original;
    });
    await expect(
      persistence.readClientConfigStore(file, new stores.InMemorySecretStore()),
    ).rejects.toBe(original);
  });

  it("migration re-reads under the lock: a file deleted meanwhile yields an empty config", async () => {
    await fs.writeFile(file, JSON.stringify(configWithPlaintextSecret));
    const { persistence, stores } = await freshWithLock(async (_p, fn) => {
      await fs.rm(file, { force: true });
      return fn();
    });
    const store = new stores.InMemorySecretStore();
    expect(await persistence.readClientConfigStore(file, store)).toEqual({});
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBeNull();
  });

  it("migration re-reads under the lock: a file already stripped meanwhile migrates nothing", async () => {
    await fs.writeFile(file, JSON.stringify(configWithPlaintextSecret));
    const stripped = {
      enterpriseManagedAuth: {
        idp: { issuer: "https://idp.example.com", clientId: "cid" },
      },
    };
    const { persistence, stores } = await freshWithLock(async (_p, fn) => {
      await fs.writeFile(file, JSON.stringify(stripped));
      return fn();
    });
    const store = new stores.InMemorySecretStore();
    // The fresh (already-stripped) file decides: no plaintext left, so the
    // store is never written and the fresh shape is served.
    expect(await persistence.readClientConfigStore(file, store)).toEqual(
      stripped,
    );
    expect(
      await store.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBeNull();
  });
});
