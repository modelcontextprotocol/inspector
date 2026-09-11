import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of `test-servers/configs/oauth-cimd-http.json` — the fixture
 * that makes #2242 reproducible by hand.
 *
 * #2242 (CIMD provenance surviving the SDK's issuer-binding write) shipped
 * verified by its own end-to-end tests, because nothing in this repo served a
 * **client metadata document**: in CIMD the `client_id` is a URL the
 * authorization server dereferences, so exercising it meant standing up a
 * second host. The v2.6.0 release ledger recorded that as the one row with an
 * observable UI surface and no way to reach it.
 *
 * What this file protects is the fixture itself, not the fix. The manual
 * reproduction depends on three things being true of the served document, and
 * each of them is the kind of thing that breaks silently:
 *
 *  - the AS advertises `client_id_metadata_document_supported`, or the
 *    Inspector's CIMD pre-registration bails out before storing anything;
 *  - it advertises **no** `registration_endpoint`, or a CIMD failure quietly
 *    falls back to DCR and the repro passes while proving nothing (this is
 *    exactly how the fixture first fooled its own author);
 *  - the document's `client_id` equals the URL it was fetched from, which is
 *    what makes it a legal CIMD client id rather than an arbitrary blob.
 *
 * The document is served over plain HTTP here. That is deliberate and is *not*
 * a usable `clientMetadataUrl` for the Inspector, which requires HTTPS with no
 * loopback exemption (#2305) — driving the UI needs a self-signed HTTPS
 * listener, as `docs/test-servers.md` describes. This endpoint exists for the
 * authorization-server side of the flow and for exactly these assertions.
 */
describe("CIMD showcase fixture (#2242)", () => {
  let server: TestServerHttp | null = null;

  const configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../test-servers/configs/oauth-cimd-http.json",
  );

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  /**
   * Boot the showcase config on a harness-chosen port, so this cannot collide
   * with a showcase server someone is running by hand.
   */
  async function startShowcase(): Promise<TestServerHttp> {
    const resolved = resolveConfig(loadConfig(configPath));
    const started = createTestServerHttp({
      ...resolved,
      serverInfo: createTestServerInfo("oauth-cimd-test", "1.0.0"),
      port: undefined,
    });
    await started.start();
    server = started;
    return started;
  }

  /** The MCP endpoint's origin, which is also the AS and the document host. */
  function originOf(started: TestServerHttp): string {
    return new URL(started.url).origin;
  }

  it("resolves the config with CIMD on and DCR deliberately off", () => {
    const resolved = resolveConfig(loadConfig(configPath));
    expect(resolved.oauth?.supportCIMD).toBe(true);
    // Not an oversight: with DCR available a CIMD failure silently succeeds
    // via dynamic registration, and the repro stops proving anything.
    expect(resolved.oauth?.supportDCR).toBe(false);
    expect(resolved.oauth?.clientMetadata?.redirectUris).toContain(
      "http://127.0.0.1:6276/oauth/callback",
    );
  });

  it("advertises CIMD support and no registration endpoint", async () => {
    const started = await startShowcase();
    const res = await fetch(
      `${originOf(started)}/.well-known/oauth-authorization-server`,
    );
    expect(res.ok).toBe(true);
    const metadata = await res.json();

    expect(metadata.client_id_metadata_document_supported).toBe(true);
    // The half that keeps the repro honest.
    expect(metadata.registration_endpoint).toBeUndefined();
  });

  it("serves a client metadata document whose client_id is its own URL", async () => {
    const started = await startShowcase();
    const documentUrl = `${originOf(started)}/client-metadata.json`;

    const res = await fetch(documentUrl);
    expect(res.ok).toBe(true);
    const doc = await res.json();

    // A CIMD client id IS the document's URL. Deriving it from the request
    // rather than from a configured issuer is what keeps this true when the
    // harness picks the port, as it does here.
    expect(doc.client_id).toBe(documentUrl);
    expect(doc.redirect_uris).toContain("http://127.0.0.1:6276/oauth/callback");
    // CIMD clients are public; the server's own CIMD branch issues no secret.
    expect(doc.token_endpoint_auth_method).toBe("none");
  });

  it("preserves a query-bearing document URL in the client_id it publishes", async () => {
    const started = await startShowcase();
    const documentUrl = `${originOf(started)}/client-metadata.json?profile=a`;

    const res = await fetch(documentUrl);
    expect(res.ok).toBe(true);
    const doc = await res.json();

    // CIMD turns on the document's `client_id` being the URL it was fetched
    // from. Answering `?profile=a` with the bare route would publish a
    // document that fails that equality for a client id the server just
    // served (Copilot).
    expect(doc.client_id).toBe(documentUrl);
  });

  it("rejects a clientMetadataPath that would publish a foreign client_id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cimd-config-"));
    const badPath = path.join(dir, "bad-cimd.json");
    const base = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(
      badPath,
      JSON.stringify({
        ...base,
        oauth: { ...base.oauth, clientMetadataPath: "//other-host/doc" },
      }),
    );

    try {
      // The path is not merely advertised: it becomes the document's own
      // `client_id`, so an off-origin value publishes a client id naming a
      // host this server does not serve.
      expect(() => loadConfig(badPath)).toThrow(/clientMetadataPath/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects the same path built programmatically rather than from JSON", async () => {
    const resolved = resolveConfig(loadConfig(configPath));
    const started = createTestServerHttp({
      ...resolved,
      oauth: { ...resolved.oauth!, clientMetadataPath: "/doc?version=1" },
      serverInfo: createTestServerInfo("oauth-cimd-badpath-test", "1.0.0"),
      port: undefined,
    });
    server = started;

    // `loadConfig` covers the JSON route only, so the server-setup check is
    // what catches a `ServerConfig` assembled in code — the same split the
    // two existing metadata paths have.
    await expect(started.start()).rejects.toThrow(/clientMetadataPath/);
    server = null;
  });

  it("does not serve the document when CIMD is switched off", async () => {
    const resolved = resolveConfig(loadConfig(configPath));
    const started = createTestServerHttp({
      ...resolved,
      oauth: { ...resolved.oauth!, supportCIMD: false },
      serverInfo: createTestServerInfo("oauth-cimd-off-test", "1.0.0"),
      port: undefined,
    });
    await started.start();
    server = started;

    const res = await fetch(`${originOf(started)}/client-metadata.json`);
    // Advertising a client this server would then refuse to honour is a worse
    // fixture than serving nothing at all.
    expect(res.status).toBe(404);
  });
});
