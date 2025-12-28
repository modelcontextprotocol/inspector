import { validateRedirectUrl, isPrivateUrl } from "../urlValidation";

describe("validateRedirectUrl", () => {
  describe("valid URLs", () => {
    it("should allow HTTP URLs", () => {
      expect(() => validateRedirectUrl("http://example.com")).not.toThrow();
    });

    it("should allow HTTPS URLs", () => {
      expect(() => validateRedirectUrl("https://example.com")).not.toThrow();
    });

    it("should allow URLs with ports", () => {
      expect(() =>
        validateRedirectUrl("https://example.com:8080"),
      ).not.toThrow();
    });

    it("should allow URLs with paths", () => {
      expect(() =>
        validateRedirectUrl("https://example.com/path/to/auth"),
      ).not.toThrow();
    });

    it("should allow URLs with query parameters", () => {
      expect(() =>
        validateRedirectUrl("https://example.com?param=value"),
      ).not.toThrow();
    });
  });

  describe("invalid URLs - XSS vectors", () => {
    it("should block javascript: protocol", () => {
      expect(() => validateRedirectUrl("javascript:alert('XSS')")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });

    it("should block javascript: with encoded characters", () => {
      expect(() =>
        validateRedirectUrl("javascript:alert%28%27XSS%27%29"),
      ).toThrow("Authorization URL must be HTTP or HTTPS");
    });

    it("should block data: protocol", () => {
      expect(() =>
        validateRedirectUrl("data:text/html,<script>alert('XSS')</script>"),
      ).toThrow("Authorization URL must be HTTP or HTTPS");
    });

    it("should block vbscript: protocol", () => {
      expect(() => validateRedirectUrl("vbscript:msgbox")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });

    it("should block file: protocol", () => {
      expect(() => validateRedirectUrl("file:///etc/passwd")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });

    it("should block about: protocol", () => {
      expect(() => validateRedirectUrl("about:blank")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });

    it("should block custom protocols", () => {
      expect(() => validateRedirectUrl("custom://example")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle malformed URLs", () => {
      expect(() => validateRedirectUrl("not a url")).toThrow(
        "Invalid URL: not a url",
      );
    });

    it("should handle empty string", () => {
      expect(() => validateRedirectUrl("")).toThrow("Invalid URL: ");
    });

    it("should handle URLs with unicode characters", () => {
      expect(() => validateRedirectUrl("https://例え.jp")).not.toThrow();
    });

    it("should handle URLs with case variations", () => {
      expect(() => validateRedirectUrl("HTTPS://EXAMPLE.COM")).not.toThrow();
      expect(() => validateRedirectUrl("HtTpS://example.com")).not.toThrow();
    });

    it("should handle protocol-relative URLs as invalid", () => {
      expect(() => validateRedirectUrl("//example.com")).toThrow(
        "Invalid URL: //example.com",
      );
    });

    it("should handle URLs with authentication", () => {
      expect(() =>
        validateRedirectUrl("https://user:pass@example.com"),
      ).not.toThrow();
    });
  });

  describe("security considerations", () => {
    it("should not be fooled by whitespace", () => {
      expect(() => validateRedirectUrl(" javascript:alert('XSS')")).toThrow();
      expect(() => validateRedirectUrl("javascript:alert('XSS') ")).toThrow();
    });

    it("should handle null bytes", () => {
      expect(() =>
        validateRedirectUrl("java\x00script:alert('XSS')"),
      ).toThrow();
    });

    it("should handle tab characters", () => {
      expect(() => validateRedirectUrl("java\tscript:alert('XSS')")).toThrow();
    });

    it("should handle newlines", () => {
      expect(() => validateRedirectUrl("java\nscript:alert('XSS')")).toThrow();
    });

    it("should handle mixed case protocols", () => {
      expect(() => validateRedirectUrl("JaVaScRiPt:alert('XSS')")).toThrow(
        "Authorization URL must be HTTP or HTTPS",
      );
    });
  });

  describe("SSRF protection", () => {
    it("should block localhost", () => {
      expect(() => validateRedirectUrl("http://localhost/callback")).toThrow(
        "private/internal address",
      );
    });

    it("should block localhost with port", () => {
      expect(() =>
        validateRedirectUrl("http://localhost:3000/callback"),
      ).toThrow("private/internal address");
    });

    it("should block 127.0.0.1", () => {
      expect(() => validateRedirectUrl("http://127.0.0.1/callback")).toThrow(
        "private/internal address",
      );
    });

    it("should block 127.x.x.x range", () => {
      expect(() => validateRedirectUrl("http://127.0.0.2:8080/")).toThrow(
        "private/internal address",
      );
    });

    it("should block private 10.x.x.x range", () => {
      expect(() => validateRedirectUrl("http://10.0.0.1/callback")).toThrow(
        "private/internal address",
      );
      expect(() => validateRedirectUrl("http://10.255.255.255/")).toThrow(
        "private/internal address",
      );
    });

    it("should block private 172.16-31.x.x range", () => {
      expect(() => validateRedirectUrl("http://172.16.0.1/callback")).toThrow(
        "private/internal address",
      );
      expect(() => validateRedirectUrl("http://172.31.255.255/")).toThrow(
        "private/internal address",
      );
    });

    it("should allow non-private 172.x.x.x", () => {
      // 172.15.x.x and 172.32.x.x are public
      expect(() =>
        validateRedirectUrl("http://172.15.0.1/callback"),
      ).not.toThrow();
      expect(() =>
        validateRedirectUrl("http://172.32.0.1/callback"),
      ).not.toThrow();
    });

    it("should block private 192.168.x.x range", () => {
      expect(() => validateRedirectUrl("http://192.168.0.1/callback")).toThrow(
        "private/internal address",
      );
      expect(() => validateRedirectUrl("http://192.168.255.255/")).toThrow(
        "private/internal address",
      );
    });

    it("should block link-local 169.254.x.x", () => {
      expect(() => validateRedirectUrl("http://169.254.1.1/callback")).toThrow(
        "private/internal address",
      );
    });

    it("should block AWS/GCP metadata endpoint 169.254.169.254", () => {
      expect(() =>
        validateRedirectUrl("http://169.254.169.254/latest/meta-data/"),
      ).toThrow("private/internal address");
    });

    it("should block IPv6 localhost [::1]", () => {
      expect(() => validateRedirectUrl("http://[::1]/callback")).toThrow(
        "private/internal address",
      );
    });

    it("should block IPv6 link-local [fe80::]", () => {
      expect(() => validateRedirectUrl("http://[fe80::1]/callback")).toThrow(
        "private/internal address",
      );
    });

    it("should allow private IPs with allowPrivateIPs option", () => {
      expect(() =>
        validateRedirectUrl("http://localhost/callback", {
          allowPrivateIPs: true,
        }),
      ).not.toThrow();
      expect(() =>
        validateRedirectUrl("http://127.0.0.1/callback", {
          allowPrivateIPs: true,
        }),
      ).not.toThrow();
      expect(() =>
        validateRedirectUrl("http://192.168.1.1/callback", {
          allowPrivateIPs: true,
        }),
      ).not.toThrow();
    });

    it("should allow public IPs", () => {
      expect(() =>
        validateRedirectUrl("https://api.example.com/callback"),
      ).not.toThrow();
      expect(() =>
        validateRedirectUrl("https://8.8.8.8/callback"),
      ).not.toThrow();
      expect(() =>
        validateRedirectUrl("https://1.1.1.1/callback"),
      ).not.toThrow();
    });
  });
});

describe("isPrivateUrl", () => {
  it("should return true for localhost", () => {
    expect(isPrivateUrl("http://localhost/")).toBe(true);
  });

  it("should return true for private IPs", () => {
    expect(isPrivateUrl("http://127.0.0.1/")).toBe(true);
    expect(isPrivateUrl("http://10.0.0.1/")).toBe(true);
    expect(isPrivateUrl("http://192.168.1.1/")).toBe(true);
    expect(isPrivateUrl("http://172.16.0.1/")).toBe(true);
  });

  it("should return true for metadata endpoints", () => {
    expect(isPrivateUrl("http://169.254.169.254/")).toBe(true);
  });

  it("should return false for public IPs", () => {
    expect(isPrivateUrl("https://example.com/")).toBe(false);
    expect(isPrivateUrl("https://8.8.8.8/")).toBe(false);
    expect(isPrivateUrl("https://api.github.com/")).toBe(false);
  });

  it("should return false for invalid URLs", () => {
    expect(isPrivateUrl("not a url")).toBe(false);
  });
});
