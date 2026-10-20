/**
 * A throwaway self-signed key/certificate pair for the TLS listener tests
 * (#2446), generated into a fresh temp directory per suite.
 *
 * Generated rather than committed: a checked-in private key trips secret
 * scanners and a checked-in certificate eventually expires, turning a green
 * suite red on a date nobody chose. `openssl` ships on every runner this repo
 * targets (CI is ubuntu-latest; macOS has LibreSSL), and a missing binary
 * fails the suite loudly in `beforeAll` rather than skipping it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SelfSignedTlsFixture {
  dir: string;
  keyPath: string;
  certPath: string;
  cleanup: () => void;
}

export function createSelfSignedTls(): SelfSignedTlsFixture {
  const dir = mkdtempSync(join(tmpdir(), "inspector-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return {
    dir,
    keyPath,
    certPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
