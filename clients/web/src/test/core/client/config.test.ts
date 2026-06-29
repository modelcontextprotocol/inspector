import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import {
  InMemorySecretStore,
  SECRET_FIELD_IDP_CLIENT_SECRET,
} from "@inspector/core/auth/node/secret-store.js";
import {
  CLIENT_KEYCHAIN_ID,
  extractSecretsFromClientConfig,
  mergeSecretsIntoClientConfig,
} from "@inspector/core/client/secrets.js";
import {
  loadClientConfig,
  parseClientConfig,
  saveClientConfig,
} from "@inspector/core/client/config.js";
import {
  formatClientConfigLoadError,
  isAbsoluteHttpUrl,
} from "@inspector/core/client/config-parse.js";
import {
  getActiveEnterpriseManagedAuthIdp,
  isEnterpriseManagedAuthEnabled,
} from "@inspector/core/client/types.js";

describe("client config", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parseClientConfig accepts enterpriseManagedAuth.idp", () => {
    const config = parseClientConfig({
      enterpriseManagedAuth: {
        idp: {
          issuer: "https://idp.example.com",
          clientId: "cid",
          clientSecret: "secret",
        },
      },
    });
    expect(config.enterpriseManagedAuth?.idp.issuer).toBe(
      "https://idp.example.com",
    );
  });

  it("parseClientConfig rejects invalid issuer URL", () => {
    expect(() =>
      parseClientConfig({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https;//idp.xaa.dev",
            clientId: "cid",
            clientSecret: "secret",
          },
        },
      }),
    ).toThrow(/Invalid URL.*https;\/\//);
  });

  it("parseClientConfig accepts enabled: false with stored IdP", () => {
    const config = parseClientConfig({
      enterpriseManagedAuth: {
        enabled: false,
        idp: {
          issuer: "https://idp.example.com",
          clientId: "cid",
          clientSecret: "secret",
        },
      },
    });
    expect(config.enterpriseManagedAuth?.enabled).toBe(false);
    expect(isEnterpriseManagedAuthEnabled(config)).toBe(false);
    expect(getActiveEnterpriseManagedAuthIdp(config)).toBeUndefined();
  });

  it("parseClientConfig rejects missing issuer", () => {
    expect(() =>
      parseClientConfig({
        enterpriseManagedAuth: {
          idp: { clientId: "c", clientSecret: "s" },
        },
      }),
    ).toThrow();
  });

  it("isAbsoluteHttpUrl accepts http(s) URLs and trims, rejects others", () => {
    expect(isAbsoluteHttpUrl("https://idp.example.com")).toBe(true);
    expect(isAbsoluteHttpUrl("http://localhost:6274")).toBe(true);
    expect(isAbsoluteHttpUrl("  https://idp.example.com  ")).toBe(true);
    expect(isAbsoluteHttpUrl("not-a-url")).toBe(false);
    expect(isAbsoluteHttpUrl("")).toBe(false);
  });

  it("isAbsoluteHttpUrl accepts dotted domains, IPv4, IPv6 and localhost", () => {
    expect(isAbsoluteHttpUrl("https://idp.example.com/realms/main")).toBe(true);
    expect(isAbsoluteHttpUrl("https://127.0.0.1:8443")).toBe(true);
    expect(isAbsoluteHttpUrl("http://[::1]:3000")).toBe(true);
    expect(isAbsoluteHttpUrl("https://你好.com")).toBe(true);
  });

  it("isAbsoluteHttpUrl rejects bare/degenerate hosts the URL parser allows", () => {
    // "Looks like a URL" but is not actually one — these all parse and start
    // with https:// yet have no real host.
    expect(isAbsoluteHttpUrl("https://")).toBe(false);
    expect(isAbsoluteHttpUrl("https://foo")).toBe(false); // single-label
    expect(isAbsoluteHttpUrl("https://example")).toBe(false); // no TLD
    expect(isAbsoluteHttpUrl("https://.")).toBe(false);
    expect(isAbsoluteHttpUrl("https://..")).toBe(false);
    expect(isAbsoluteHttpUrl("https://idp..example.com")).toBe(false); // empty label
    expect(isAbsoluteHttpUrl("https:///path")).toBe(false); // empty host
  });

  it("isAbsoluteHttpUrl rejects non-http(s) schemes", () => {
    expect(isAbsoluteHttpUrl("foo:bar")).toBe(false);
    expect(isAbsoluteHttpUrl("mailto:a@b.com")).toBe(false);
    expect(isAbsoluteHttpUrl("ftp://idp.example.com")).toBe(false);
    expect(isAbsoluteHttpUrl("javascript:void(0)")).toBe(false);
  });

  it("parseClientConfig rejects a non-http(s) issuer scheme", () => {
    expect(() =>
      parseClientConfig({
        enterpriseManagedAuth: {
          idp: { issuer: "mailto:idp@example.com", clientId: "c" },
        },
      }),
    ).toThrow(/Invalid URL/);
  });

  it("loadClientConfig returns {} when file is absent", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-config-"));
    const filePath = path.join(tmpDir, "client.json");
    const config = await loadClientConfig({ filePath });
    expect(config).toEqual({});
  });

  it("formatClientConfigLoadError summarizes Zod validation failures", () => {
    try {
      parseClientConfig({
        enterpriseManagedAuth: {
          idp: { issuer: "not-a-url", clientId: "c", clientSecret: "s" },
        },
      });
    } catch (err) {
      const message = formatClientConfigLoadError(err);
      expect(message).toContain("issuer");
      expect(message).toContain("Invalid URL");
      return;
    }
    throw new Error("expected parseClientConfig to throw");
  });

  it("formatClientConfigLoadError passes through Error message", () => {
    expect(formatClientConfigLoadError(new Error("network down"))).toBe(
      "network down",
    );
  });

  it("extractSecretsFromClientConfig strips IdP clientSecret", () => {
    const input = {
      enterpriseManagedAuth: {
        idp: {
          issuer: "https://idp.example.com",
          clientId: "cid",
          clientSecret: "secret",
        },
      },
    };
    const { stripped, secrets } = extractSecretsFromClientConfig(input);
    expect(stripped.enterpriseManagedAuth?.idp).toEqual({
      issuer: "https://idp.example.com",
      clientId: "cid",
    });
    expect(secrets[SECRET_FIELD_IDP_CLIENT_SECRET]).toBe("secret");
    expect(
      mergeSecretsIntoClientConfig(stripped, secrets).enterpriseManagedAuth?.idp
        .clientSecret,
    ).toBe("secret");
  });

  it("saveClientConfig round-trips via loadClientConfig with keychain", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-config-"));
    const filePath = path.join(tmpDir, "client.json");
    const secretStore = new InMemorySecretStore();
    const input = {
      enterpriseManagedAuth: {
        idp: {
          issuer: "https://idp.example.com",
          clientId: "inspector",
          clientSecret: "shh",
        },
      },
    };
    await saveClientConfig(input, { filePath, secretStore });
    const loaded = await loadClientConfig({ filePath, secretStore });
    expect(loaded).toEqual(input);

    const onDisk = JSON.parse(readFileSync(filePath, "utf-8")) as {
      enterpriseManagedAuth?: { idp?: Record<string, string> };
    };
    expect(onDisk.enterpriseManagedAuth?.idp?.clientSecret).toBeUndefined();
    expect(readFileSync(filePath, "utf-8")).not.toContain("shh");
    expect(
      await secretStore.get(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET),
    ).toBe("shh");
  });
});
