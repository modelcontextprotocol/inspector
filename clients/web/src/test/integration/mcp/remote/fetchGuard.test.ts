/**
 * `guardedFetch` on its direct path — undici over the pinning lookup (#2749).
 *
 * The hostnames here (`*.test`) exist only in the injected resolver, so a
 * request that reaches the fixture proves the socket connected to the address
 * the guard validated rather than to one it resolved for itself. The proxied
 * mode and the pure helpers are covered by the unit suite
 * (`src/test/core/mcp/remote/node/fetchGuard.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  FetchTargetError,
  findFetchTargetError,
  guardedFetch,
  type GuardedFetchInit,
  type ResolveHost,
} from "@inspector/core/mcp/remote/node/fetchGuard.js";

let server: Server;
let port: number;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(`${req.headers.host} ${req.url}`);
    if (req.url === "/to-metadata-name") {
      res.writeHead(302, { Location: `http://metadata.test:${port}/` });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pinned");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/** Resolves `*.test` names from a fixed table, as a rebinding DNS would. */
const resolveHost: ResolveHost = async (hostname) => {
  if (hostname === "pinned.test") return ["127.0.0.1"];
  if (hostname === "metadata.test") return ["169.254.169.254"];
  throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
    code: "ENOTFOUND",
  });
};

function init(): GuardedFetchInit {
  return {
    method: "GET",
    headers: {},
    body: undefined,
    signal: AbortSignal.timeout(5_000),
  };
}

describe("guardedFetch (direct)", () => {
  it("connects to the address the guard validated", async () => {
    const res = await guardedFetch(`http://pinned.test:${port}/x`, init(), {
      resolveHost,
    });
    expect(await res.text()).toBe("pinned");
    expect(res).toBeInstanceOf(Response);
    expect(hits).toContain(`pinned.test:${port} /x`);
  });

  it("refuses a name that resolves to a metadata address", async () => {
    const err: unknown = await guardedFetch(
      `http://metadata.test:${port}/`,
      init(),
      { resolveHost },
    ).catch((e: unknown) => e);
    expect(findFetchTargetError(err)).toBeInstanceOf(FetchTargetError);
  });

  it("refuses a redirect to such a name", async () => {
    const before = hits.length;
    const err: unknown = await guardedFetch(
      `http://pinned.test:${port}/to-metadata-name`,
      init(),
      { resolveHost },
    ).catch((e: unknown) => e);
    expect(findFetchTargetError(err)?.message).toContain("169.254.169.254");
    expect(hits.slice(before)).toEqual([
      `pinned.test:${port} /to-metadata-name`,
    ]);
  });

  it("surfaces an unresolvable name as an ordinary fetch failure", async () => {
    const err: unknown = await guardedFetch(
      `http://nowhere.test:${port}/`,
      init(),
      { resolveHost },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(findFetchTargetError(err)).toBeUndefined();
  });
});
