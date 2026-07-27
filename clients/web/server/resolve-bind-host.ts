/**
 * Resolves and validates the hostname the web server (prod backend + Vite dev
 * server) binds to. Enforces the localhost-only default so the Inspector can't
 * accidentally expose its process-spawning proxy to the whole network.
 *
 * Shared by `web-server-config.ts` (the Node backend) and `vite.config.ts` (the
 * dev server) so both bind points enforce the same policy.
 */

import {
  canonicalUrlHost,
  isAllInterfacesHost,
  stripBrackets,
} from "../../../core/node/hostUrl.ts";

/** Env var that opts into binding all network interfaces (see {@link resolveBindHostname}). */
export const BIND_ALL_INTERFACES_ENV = "DANGEROUSLY_BIND_ALL_INTERFACES";

/**
 * An explicit, unambiguous opt-in. Unlike a bare `!!value` (which treats the
 * string `"false"` as truthy), only `"true"`/`"1"` (case-insensitive) enable
 * the override, so `DANGEROUSLY_BIND_ALL_INTERFACES=false` reads as "off".
 */
function isEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Resolve the bind hostname from `env` (default `process.env`), defaulting to
 * `localhost`. Refuses an all-interfaces host (`0.0.0.0` / `::` / empty / their
 * legacy spellings) unless {@link BIND_ALL_INTERFACES_ENV} is explicitly
 * enabled — the published Docker image sets it, since a container must bind
 * `0.0.0.0` to be reachable through `-p`. Throws (fail fast, loudly) rather than
 * silently binding wide open. The returned value is trimmed and de-bracketed
 * (an IPv6 literal is returned bare, e.g. `HOST=[::1]` → `::1`) so detection,
 * `listen()`, and the origin list all consume the same value; `formatHostForUrl`
 * re-adds the brackets wherever a URL is built.
 */
export function resolveBindHostname(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = (env.HOST ?? "localhost").trim();
  if (isAllInterfacesHost(host) && !isEnabled(env[BIND_ALL_INTERFACES_ENV])) {
    // Show the resolved address when it differs from the typed spelling — the
    // guard now catches forms the resolver folds to the wildcard (a fullwidth
    // `HOST="０"` renders like `0`, `HOST=0` / `0x0` / `::0` bind `0.0.0.0`), and
    // "bind a loopback host" reads as a non-sequitur without that hint.
    const resolved = canonicalUrlHost(host);
    // Compare de-bracketed on BOTH sides so neither a plain `HOST="::"` nor a
    // bracketed `HOST="[::]"` is reported as "(resolves to [::])" — the
    // bracketing is a URL-authority detail, not a resolution.
    const shown =
      stripBrackets(resolved) === stripBrackets(host.toLowerCase())
        ? `HOST="${host}"`
        : `HOST="${host}" (resolves to ${resolved})`;
    throw new Error(
      `Refusing to bind ${shown}: this exposes the MCP Inspector to your ` +
        `entire network, and its backend can spawn local processes and connect ` +
        `to MCP servers on your behalf — the exposure DNS-rebinding attacks ` +
        `target. Bind a loopback host (localhost / 127.0.0.1) instead. To ` +
        `override — only inside an isolated container or trusted network — set ` +
        `${BIND_ALL_INTERFACES_ENV}=true.`,
    );
  }
  return stripBrackets(host);
}
