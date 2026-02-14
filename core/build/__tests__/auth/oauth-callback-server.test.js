import { describe, it, expect, afterEach } from "vitest";
import { createOAuthCallbackServer, } from "../../auth/node/oauth-callback-server.js";
describe("OAuthCallbackServer", () => {
    let server;
    afterEach(async () => {
        if (server)
            await server.stop();
    });
    it("start() returns port and redirectUrl", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        expect(result.port).toBeGreaterThan(0);
        expect(result.redirectUrl).toBe(`http://127.0.0.1:${result.port}/oauth/callback`);
    });
    it("start() supports custom host, path, and port", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({
            hostname: "127.0.0.1",
            port: 0,
            path: "/custom/path",
        });
        expect(result.redirectUrl).toBe(`http://127.0.0.1:${result.port}/custom/path`);
    });
    it("GET /oauth/callback?code=abc&state=xyz returns 200 and invokes onCallback", async () => {
        server = createOAuthCallbackServer();
        const received = {};
        const result = await server.start({
            port: 0,
            onCallback: async (p) => {
                received.code = p.code;
                received.state = p.state;
            },
        });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?code=authcode123&state=mystate`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        const html = await res.text();
        expect(html).toContain("OAuth complete");
        expect(html).toContain("close this window");
        expect(received.code).toBe("authcode123");
        expect(received.state).toBe("mystate");
    });
    it("GET /oauth/callback?code=abc returns 200 and invokes onCallback without state", async () => {
        server = createOAuthCallbackServer();
        const received = {};
        const result = await server.start({
            port: 0,
            onCallback: async (p) => {
                received.code = p.code;
                received.state = p.state;
            },
        });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?code=xyz`);
        expect(res.status).toBe(200);
        expect(received.code).toBe("xyz");
        expect(received.state).toBeUndefined();
    });
    it("GET /oauth/callback/guided returns 404 (single path only)", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback/guided?code=guided-code`);
        expect(res.status).toBe(404);
    });
    it("GET /oauth/callback?error=access_denied returns 400 and invokes onError", async () => {
        server = createOAuthCallbackServer();
        const errors = [];
        const result = await server.start({
            port: 0,
            onError: (p) => errors.push(p),
        });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?error=access_denied&error_description=User%20denied`);
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("OAuth failed");
        expect(html).toContain("access_denied");
        expect(errors).toHaveLength(1);
        expect(errors[0].error).toBe("access_denied");
        expect(errors[0].error_description).toBe("User denied");
    });
    it("GET /oauth/callback (missing code and error) returns 400", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?state=foo`);
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("OAuth failed");
    });
    it("GET /other returns 404", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        const res = await fetch(`http://localhost:${result.port}/other`);
        expect(res.status).toBe(404);
    });
    it("POST /oauth/callback returns 405", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?code=x`, { method: "POST" });
        expect(res.status).toBe(405);
    });
    it("stops server after first successful callback so second request fails", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({
            port: 0,
            onCallback: async () => { },
        });
        const first = await fetch(`http://localhost:${result.port}/oauth/callback?code=first`);
        expect(first.status).toBe(200);
        // Server stops after sending 200, so second request gets connection refused
        await expect(fetch(`http://localhost:${result.port}/oauth/callback?code=second`)).rejects.toThrow();
    });
    it("stop() closes the server", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({ port: 0 });
        await server.stop();
        await expect(fetch(`http://localhost:${result.port}/oauth/callback?code=x`)).rejects.toThrow();
    });
    it("onCallback rejection returns 500 and error HTML", async () => {
        server = createOAuthCallbackServer();
        const result = await server.start({
            port: 0,
            onCallback: async () => {
                throw new Error("exchange failed");
            },
        });
        const res = await fetch(`http://localhost:${result.port}/oauth/callback?code=abc`);
        expect(res.status).toBe(500);
        const html = await res.text();
        expect(html).toContain("OAuth failed");
        expect(html).toContain("exchange failed");
    });
});
//# sourceMappingURL=oauth-callback-server.test.js.map