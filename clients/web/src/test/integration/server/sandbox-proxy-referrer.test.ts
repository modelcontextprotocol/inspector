import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage for the sandbox proxy's embedder check (#1944).
 *
 * `clients/web/static/sandbox_proxy.html` is the **third** gate an embedder
 * passes, after the backend's origin allow-list and the proxy response's
 * `frame-ancestors`. It is plain inline script in a static file — it ships as
 * bytes, is never bundled, and cannot read server configuration — so nothing
 * else in the suite touches it, and it was left rejecting `*.localhost` while
 * the other two gates were widened. That combination is the worst one: the app
 * loads, connects, and only the Apps tab fails.
 *
 * The function is extracted from the shipped file and evaluated rather than
 * imported, because there is no module to import. That is deliberate and it is
 * the point: the assertions run against the exact text that gets served, so a
 * change to the file is a change to this test's subject.
 */
const proxyHtml = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../static/sandbox_proxy.html",
  ),
  "utf-8",
);

function loadIsAllowedEmbedder(): (referrer: string) => boolean {
  const source = /function isAllowedEmbedder[\s\S]*?\n {6}}\n/.exec(proxyHtml);
  if (!source) {
    throw new Error(
      "isAllowedEmbedder was not found in sandbox_proxy.html — if it was " +
        "renamed or restructured, update this extraction rather than deleting " +
        "the coverage.",
    );
  }
  return new Function(`${source[0]}; return isAllowedEmbedder;`)() as (
    referrer: string,
  ) => boolean;
}

describe("sandbox proxy embedder check", () => {
  const isAllowedEmbedder = loadIsAllowedEmbedder();

  it.each([
    // The two literals it has always admitted, unchanged.
    "http://localhost:6274/",
    "http://127.0.0.1:6274/",
    // The newly supported space (#1944), at any depth and any port.
    "http://mcp.localhost/",
    "http://tenant.app.localhost:3300/",
    // Both schemes, matching the backend's own predicate.
    "https://mcp.localhost:8443/",
  ])("admits %j", (referrer) => {
    expect(isAllowedEmbedder(referrer)).toBe(true);
  });

  it.each([
    // Not the reserved suffix — an attacker-registrable name that merely
    // contains or resembles it.
    "http://mcp.localhost.evil.com/",
    "http://evil.com/",
    "http://notlocalhost/",
    "http://localhost.evil.com/",
    // A path segment that looks like a host. The check parses, so the host is
    // `evil.com` and the rest is a path.
    "http://evil.com/localhost",
    // Degenerate labels.
    "http://.localhost/",
    "http://a..localhost/",
    // Root-dotted, rejected here exactly as the backend rejects it: its CSP
    // `frame-ancestors` source cannot be expressed, so admitting it would only
    // move the failure one frame inward.
    "http://app.localhost./",
    // Unchanged: the bare literals stay http-only.
    "https://localhost:6274/",
    // Not a URL at all, and the empty referrer the caller already guards.
    "not a url",
    "",
  ])("rejects %j", (referrer) => {
    expect(isAllowedEmbedder(referrer)).toBe(false);
  });

  it("reads the host, not the userinfo", () => {
    // The dangerous direction: the real host is `evil.com` and the reserved
    // name is only credentials. Rejecting this is the property that makes
    // hardcoding a suffix safe at all.
    expect(isAllowedEmbedder("http://localhost@evil.com/")).toBe(false);
    expect(isAllowedEmbedder("http://app.localhost@evil.com/")).toBe(false);
    expect(isAllowedEmbedder("http://127.0.0.1@evil.com/")).toBe(false);
  });
});
