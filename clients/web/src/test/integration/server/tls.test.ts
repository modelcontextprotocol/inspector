import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, get } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  resolveTlsConfig,
  TLS_CERT_PATH_ENV,
  TLS_KEY_PATH_ENV,
  webScheme,
} from "../../../../server/tls.js";
import {
  createSelfSignedTls,
  type SelfSignedTlsFixture,
} from "../../fixtures/selfSignedTls.js";

let fixture: SelfSignedTlsFixture;

beforeAll(() => {
  fixture = createSelfSignedTls();
});

afterAll(() => {
  fixture.cleanup();
});

const env = (key?: string, cert?: string): NodeJS.ProcessEnv => ({
  ...(key !== undefined ? { [TLS_KEY_PATH_ENV]: key } : {}),
  ...(cert !== undefined ? { [TLS_CERT_PATH_ENV]: cert } : {}),
});

describe("resolveTlsConfig", () => {
  it("returns undefined when neither variable is set", () => {
    expect(resolveTlsConfig(env())).toBeUndefined();
  });

  it("treats blank values as unset", () => {
    expect(resolveTlsConfig(env("", "  "))).toBeUndefined();
  });

  it("reads process.env by default", () => {
    // The suite's own environment carries neither variable.
    expect(process.env[TLS_KEY_PATH_ENV]).toBeUndefined();
    expect(process.env[TLS_CERT_PATH_ENV]).toBeUndefined();
    expect(resolveTlsConfig()).toBeUndefined();
  });

  it("refuses a key path without a cert path, naming both variables", () => {
    expect(() => resolveTlsConfig(env(fixture.keyPath))).toThrow(
      `TLS needs both ${TLS_KEY_PATH_ENV} and ${TLS_CERT_PATH_ENV}; ${TLS_CERT_PATH_ENV} is not set.`,
    );
  });

  it("refuses a cert path without a key path, naming both variables", () => {
    expect(() => resolveTlsConfig(env(undefined, fixture.certPath))).toThrow(
      `TLS needs both ${TLS_KEY_PATH_ENV} and ${TLS_CERT_PATH_ENV}; ${TLS_KEY_PATH_ENV} is not set.`,
    );
  });

  it("counts a blank partner as unset rather than enabling TLS", () => {
    expect(() => resolveTlsConfig(env(fixture.keyPath, " "))).toThrow(
      `${TLS_CERT_PATH_ENV} is not set`,
    );
  });

  it("reads both PEM files when both are set", () => {
    expect(
      resolveTlsConfig(env(` ${fixture.keyPath} `, fixture.certPath)),
    ).toEqual({
      key: readFileSync(fixture.keyPath, "utf-8"),
      cert: readFileSync(fixture.certPath, "utf-8"),
    });
  });

  it("produces options an https listener serves with", async () => {
    const tls = resolveTlsConfig(env(fixture.keyPath, fixture.certPath));
    const server = createServer(tls!, (_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as AddressInfo;
      const body = await new Promise<string>((resolve, reject) => {
        // Trust exactly the fixture's certificate — verification stays on.
        get({ host: "127.0.0.1", port, path: "/", ca: tls!.cert }, (res) => {
          let data = "";
          res.on("data", (c: Buffer) => (data += c.toString()));
          res.on("end", () => resolve(data));
        }).on("error", reject);
      });
      expect(body).toBe("ok");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("names the unreadable key path and its error code, not a raw ENOENT", () => {
    const missing = join(fixture.dir, "nope-key.pem");
    let message = "";
    try {
      resolveTlsConfig(env(missing, fixture.certPath));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe(
      `Cannot read ${TLS_KEY_PATH_ENV}="${missing}" (ENOENT): check that the file exists and is readable.`,
    );
  });

  it("names the unreadable cert path", () => {
    // A directory is not readable as a file (EISDIR).
    expect(() => resolveTlsConfig(env(fixture.keyPath, fixture.dir))).toThrow(
      `Cannot read ${TLS_CERT_PATH_ENV}="${fixture.dir}" (EISDIR)`,
    );
  });

  it("refuses a file that is not PEM", () => {
    const junk = join(fixture.dir, "junk.pem");
    writeFileSync(junk, "not a certificate\n");
    expect(() => resolveTlsConfig(env(fixture.keyPath, junk))).toThrow(
      `${TLS_KEY_PATH_ENV}="${fixture.keyPath}" and ${TLS_CERT_PATH_ENV}="${junk}" are not a usable PEM key/certificate pair (`,
    );
  });

  it("refuses a key that does not match the certificate", () => {
    const otherKey = join(fixture.dir, "other-key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(
      otherKey,
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    );
    expect(() => resolveTlsConfig(env(otherKey, fixture.certPath))).toThrow(
      /are not a usable PEM key\/certificate pair/,
    );
  });
});

describe("webScheme", () => {
  it("is https with a TLS config and http without", () => {
    expect(webScheme({ key: "k", cert: "c" })).toBe("https");
    expect(webScheme(undefined)).toBe("http");
  });
});
