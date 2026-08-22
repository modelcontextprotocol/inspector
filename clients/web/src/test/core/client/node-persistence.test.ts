import { describe, it, expect, afterEach } from "vitest";
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
});
