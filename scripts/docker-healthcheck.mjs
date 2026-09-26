#!/usr/bin/env node
/**
 * The Docker image's HEALTHCHECK probe (#2424).
 *
 * The probe used to be an inline `node -e` that fetched a hardcoded
 * `http://127.0.0.1:$CLIENT_PORT/`. That agrees with the image's default
 * `HOST=0.0.0.0` only because a wildcard bind also listens on loopback: a
 * `docker run -e HOST=172.17.0.2 …` binds that one interface, nothing answers
 * on `127.0.0.1`, and a container serving fine is reported unhealthy. So the
 * probe derives its address from the same `HOST` the server binds, the way it
 * already derived the port from `CLIENT_PORT`.
 *
 * `HOST` is a *bind* address and this needs a *connect* address, so a wildcard
 * cannot be used verbatim: the IPv4 wildcard (and the empty host, which Node's
 * `listen()` treats as unspecified) maps to `127.0.0.1`, the IPv6 wildcard to
 * `[::1]`. Every other host is used as the server would bind it, except that
 * an IPv6 zone id (`fe80::1%eth0`) is dropped: a URL authority cannot carry
 * one, so a link-local bind is not probed on its own scope. `CLIENT_PORT` is
 * trimmed and an empty value treated as unset, as the server does.
 *
 * It is a file rather than the `node -e` one-liner so it can be tested — the
 * image installs only the packed tarball, so it cannot import
 * `core/node/hostUrl.ts`; the few lines of host handling below lean on
 * `new URL()` for canonicalization, the same primitive `canonicalUrlHost`
 * uses, so legacy spellings (`HOST=0`, `0x0`, `::0`) resolve to the wildcard
 * the socket actually binds. `/` needs no auth, and Node's global `fetch` is
 * used because the slim image has no curl or wget.
 */

import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "6274";

/**
 * Wildcard bind hosts, as `new URL().hostname` spells them, mapped to the
 * loopback address a probe connects to. `[::ffff:0:0]` is the IPv4-mapped
 * wildcard, which the web bind guard also treats as all-interfaces.
 */
const WILDCARD_TO_LOOPBACK = new Map([
  ["0.0.0.0", "127.0.0.1"],
  ["[::ffff:0:0]", "127.0.0.1"],
  ["[::]", "[::1]"],
]);

/**
 * The URL the healthcheck fetches, derived from `HOST` and `CLIENT_PORT` in
 * `env`. Throws when `HOST` is not a valid URL host, which the caller reports
 * as unhealthy — a server could not have bound it either.
 */
export function probeUrl(env) {
  // Matches web-server-config.ts: trimmed, and empty means unset.
  const port = env.CLIENT_PORT?.trim() || DEFAULT_PORT;
  // The server de-brackets an IPv6 HOST and a URL authority cannot carry a
  // zone id, so strip both before re-bracketing any IPv6 literal.
  const bare = (env.HOST ?? DEFAULT_HOST)
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .split("%")[0];
  if (bare === "") return `http://${DEFAULT_HOST}:${port}/`;
  const authority = bare.includes(":") ? `[${bare}]` : bare;
  const host = new URL(`http://${authority}`).hostname;
  return `http://${WILDCARD_TO_LOOPBACK.get(host) ?? host}:${port}/`;
}

/** True when the web UI answers `/` with a 2xx; false on any failure. */
export async function probe(env) {
  try {
    const res = await fetch(probeUrl(env));
    return res.ok;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit((await probe(process.env)) ? 0 : 1);
