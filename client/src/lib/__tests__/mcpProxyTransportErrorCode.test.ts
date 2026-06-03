/**
 * Compare client vs server numeric literal without importing server/mcpProxy.ts:
 * that module pulls in the SDK graph and breaks Jest (e.g. optional peer deps).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { MCP_PROXY_TRANSPORT_ERROR_CODE as clientCode } from "../constants";

const EXPORT_RE =
  /export const MCP_PROXY_TRANSPORT_ERROR_CODE\s*=\s*(-?\d+)\s*;/;

describe("MCP_PROXY_TRANSPORT_ERROR_CODE", () => {
  it("matches server/src/mcpProxy.ts (avoid silent drift between client and server)", () => {
    const serverSrcPath = resolve(
      __dirname,
      "../../../../server/src/mcpProxy.ts",
    );
    const serverSrc = readFileSync(serverSrcPath, "utf-8");
    const match = serverSrc.match(EXPORT_RE);
    expect(match).not.toBeNull();
    const serverCode = Number(match![1]);
    expect(clientCode).toBe(serverCode);
  });
});
