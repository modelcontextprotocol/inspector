import { describe, expect, it, vi } from "vitest";
import {
  SAFE_CSP_SOURCE,
  approveCspSources,
  buildSandboxCspPolicy,
  escapeHtmlAttr,
  wrapSandboxedHtml,
} from "./sandbox-csp";

describe("SAFE_CSP_SOURCE", () => {
  it.each([
    "*",
    "https://api.example.com",
    "https://api.example.com:8443",
    "https://api.example.com/path/seg",
    "wss://realtime.service.com",
    "*.example.com",
    "https://*.cloudflare.com",
    "data:",
    "blob:",
    "example.com",
  ])("accepts %s", (s) => {
    expect(SAFE_CSP_SOURCE.test(s)).toBe(true);
  });

  it.each([
    "https://a.com; script-src *",
    'https://a.com" onload=',
    "https://a.com>",
    "<script>",
    " https://a.com",
    "https://a.com ",
    "",
    "javascript:alert(1)//;x",
  ])("rejects %s", (s) => {
    expect(SAFE_CSP_SOURCE.test(s)).toBe(false);
  });
});

describe("approveCspSources", () => {
  it("returns an empty object for undefined / empty input", () => {
    expect(approveCspSources(undefined)).toEqual({});
    expect(approveCspSources({})).toEqual({});
  });

  it("keeps safe entries per key and drops unsafe ones with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const approved = approveCspSources({
      connectDomains: ["https://api.ok.com", "https://x.com; script-src *"],
      resourceDomains: ["data:", '">'],
      frameDomains: [],
      baseUriDomains: ["https://b.ok.com"],
    });
    expect(approved).toEqual({
      connectDomains: ["https://api.ok.com"],
      resourceDomains: ["data:"],
      baseUriDomains: ["https://b.ok.com"],
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("omits a key when every entry is rejected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(approveCspSources({ connectDomains: ['"; x'] })).toEqual({});
    warn.mockRestore();
  });

  it("ignores non-array values without throwing", () => {
    expect(
      approveCspSources({
        connectDomains: "https://x.com" as unknown as string[],
      }),
    ).toEqual({});
  });
});

describe("buildSandboxCspPolicy", () => {
  it("emits locked-down defaults for an empty approved csp", () => {
    const policy = buildSandboxCspPolicy({});
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("style-src 'unsafe-inline'");
    expect(policy).toContain("img-src 'none'");
    expect(policy).toContain("font-src 'none'");
    expect(policy).toContain("media-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("worker-src 'none'");
  });

  it("maps approved domains to the correct directives", () => {
    const policy = buildSandboxCspPolicy({
      connectDomains: ["https://api.a.com", "wss://rt.a.com"],
      resourceDomains: ["https://cdn.a.com"],
      frameDomains: ["https://embed.a.com"],
      baseUriDomains: ["https://a.com"],
    });
    expect(policy).toContain("connect-src https://api.a.com wss://rt.a.com");
    expect(policy).toContain("script-src 'unsafe-inline' https://cdn.a.com");
    expect(policy).toContain("style-src 'unsafe-inline' https://cdn.a.com");
    expect(policy).toContain("img-src https://cdn.a.com");
    expect(policy).toContain("font-src https://cdn.a.com");
    expect(policy).toContain("media-src https://cdn.a.com");
    expect(policy).toContain("frame-src https://embed.a.com");
    expect(policy).toContain("base-uri https://a.com");
    // catch-all directives stay locked down regardless of approved domains
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("worker-src 'none'");
  });
});

describe("escapeHtmlAttr", () => {
  it("encodes &, quotes, and angle brackets", () => {
    expect(escapeHtmlAttr(`a&b"c'd<e>f`)).toBe(
      "a&amp;b&quot;c&#39;d&lt;e&gt;f",
    );
  });
});

describe("wrapSandboxedHtml", () => {
  it("places the CSP meta as the literal first <head> child before any untrusted bytes", () => {
    const wrapped = wrapSandboxedHtml("<p>hi</p>", "default-src 'none'");
    const metaIdx = wrapped.indexOf("Content-Security-Policy");
    const bodyIdx = wrapped.indexOf("<body>");
    expect(metaIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeLessThan(bodyIdx);
    expect(wrapped.startsWith("<!DOCTYPE html><html><head><meta")).toBe(true);
  });

  it("attribute-encodes the policy value", () => {
    const wrapped = wrapSandboxedHtml("", `x"><script>`);
    expect(wrapped).toContain('content="x&quot;&gt;&lt;script&gt;"');
    expect(wrapped).not.toContain('"><script>');
  });

  it("places untrusted full-document HTML inside <body> so its own <head> token cannot precede the policy", () => {
    const evil = `<!-- <head> --><!DOCTYPE html><html><head><script src="x"></script></head><body>app</body></html>`;
    const wrapped = wrapSandboxedHtml(evil, "default-src 'none'");
    // The first <head> in the output is OURS; the untrusted <head> token only
    // appears after <body>.
    const ourHead = wrapped.indexOf("<head>");
    const body = wrapped.indexOf("<body>");
    const evilHead = wrapped.indexOf("<head>", ourHead + 1);
    expect(ourHead).toBeLessThan(body);
    expect(evilHead).toBeGreaterThan(body);
  });
});
