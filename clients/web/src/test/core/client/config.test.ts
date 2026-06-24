import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadClientConfig,
  parseClientConfig,
  saveClientConfig,
} from "@inspector/core/client/config.js";
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

  it("loadClientConfig returns {} when file is absent", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-config-"));
    const filePath = path.join(tmpDir, "client.json");
    const config = await loadClientConfig({ filePath });
    expect(config).toEqual({});
  });

  it("saveClientConfig round-trips via loadClientConfig", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "client-config-"));
    const filePath = path.join(tmpDir, "client.json");
    const input = {
      enterpriseManagedAuth: {
        idp: {
          issuer: "https://idp.example.com",
          clientId: "inspector",
          clientSecret: "shh",
        },
      },
    };
    await saveClientConfig(input, { filePath });
    const loaded = await loadClientConfig({ filePath });
    expect(loaded).toEqual(input);
  });
});
