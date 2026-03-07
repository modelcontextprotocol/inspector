import { describe, it, expect } from "vitest";
import { createRemoteApp } from "../mcp/remote/node/server.js";

describe("createRemoteApp GET /api/config", () => {
  it("includes sandboxUrl in response when option is set", async () => {
    const sandboxUrl = "http://localhost:9123/sandbox";
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      allowedOrigins: ["http://127.0.0.1:6274"],
      sandboxUrl,
    });
    const res = await app.request(new Request("http://test/api/config"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sandboxUrl?: string };
    expect(data.sandboxUrl).toBe(sandboxUrl);
  });

  it("omits sandboxUrl when option is not set", async () => {
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      allowedOrigins: ["http://127.0.0.1:6274"],
    });
    const res = await app.request(new Request("http://test/api/config"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sandboxUrl?: string };
    expect(data).not.toHaveProperty("sandboxUrl");
  });
});
