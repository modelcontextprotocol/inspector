import { describe, it, expect } from "vitest";
import { injectAuthToken } from "../../../../server/inject-auth-token.js";
import { INSPECTOR_API_TOKEN_GLOBAL } from "../../../../../../core/mcp/remote/constants.js";

const TOKEN = "deadbeefcafef00d";
const scriptFor = (token: string) =>
  `window.${INSPECTOR_API_TOKEN_GLOBAL} = ${JSON.stringify(token)};`;

describe("injectAuthToken", () => {
  it("injects the token global just before </head>", () => {
    const html = "<html><head><title>X</title></head><body></body></html>";
    const out = injectAuthToken(html, TOKEN);
    expect(out).toContain(scriptFor(TOKEN));
    // The script must land inside <head>, ahead of the closing tag.
    const scriptIdx = out.indexOf(scriptFor(TOKEN));
    const headCloseIdx = out.indexOf("</head>");
    expect(scriptIdx).toBeLessThan(headCloseIdx);
    expect(scriptIdx).toBeGreaterThan(out.indexOf("<head>"));
  });

  it("falls back to before </body> when there is no </head>", () => {
    const html = "<html><body><div id='root'></div></body></html>";
    const out = injectAuthToken(html, TOKEN);
    const scriptIdx = out.indexOf(scriptFor(TOKEN));
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(out.indexOf("</body>"));
  });

  it("prepends when there is neither </head> nor </body>", () => {
    const html = "<div id='root'></div>";
    const out = injectAuthToken(html, TOKEN);
    expect(out.startsWith(`<script>${scriptFor(TOKEN)}</script>`)).toBe(true);
    expect(out.endsWith(html)).toBe(true);
  });

  it("returns the html untouched for an empty token (auth disabled)", () => {
    const html = "<html><head></head><body></body></html>";
    expect(injectAuthToken(html, "")).toBe(html);
  });

  it("escapes a token containing </script> so the tag can't close early", () => {
    const evil = "abc</script><script>alert(1)</script>";
    const out = injectAuthToken("<head></head>", evil);
    // The raw, unescaped sequence must not survive into the output.
    expect(out).not.toContain("</script><script>alert(1)");
    // The `<` of the embedded literal is escaped to its JS unicode form.
    expect(out).toContain("\\u003c/script>");
    // Exactly one opening + one closing script tag (our wrapper) remain.
    expect(out.match(/<script>/g)).toHaveLength(1);
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it("round-trips the token value through JSON so the browser reads it back", () => {
    const html = "<head></head>";
    const out = injectAuthToken(html, TOKEN);
    // Recover the JSON literal the browser would evaluate and confirm it
    // parses back to the original token.
    const match = out.match(
      new RegExp(`window\\.${INSPECTOR_API_TOKEN_GLOBAL} = (.+?);</script>`),
    );
    expect(match).not.toBeNull();
    const parsed = JSON.parse(
      (match as RegExpMatchArray)[1].replace(/\\u003c/g, "<"),
    );
    expect(parsed).toBe(TOKEN);
  });
});
