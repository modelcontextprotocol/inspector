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
 * The default bind host: the IPv4 loopback **address**, deliberately not the
 * name `localhost`.
 *
 * `server.listen(port, host)` resolves a name through `dns.lookup` and binds the
 * **single** address it gets back. Since Node 17 the default result order is
 * `verbatim`, so Node takes whatever the resolver returns first rather than
 * preferring IPv4 — and on a glibc Linux host with the stock `/etc/hosts`
 * (`127.0.0.1 localhost` *and* `::1 localhost`) that is `::1`. `HOST=localhost`
 * therefore binds IPv6 loopback **only**, and every IPv4 client is refused.
 *
 * That is invisible on a desktop, where the browser resolves `localhost` the
 * same way and lands on `::1` too. It breaks wherever the connection is made by
 * something that pins IPv4 `127.0.0.1` instead — a VS Code dev container's port
 * forwarder (#1951), an `ssh -L …:127.0.0.1:…` tunnel, a container healthcheck.
 * Binding the address directly removes the resolver from the decision, and the
 * loopback origin allow-list already covers `localhost`, `127.0.0.1`, and
 * `[::1]` alike, so browsing to `http://localhost:PORT` still works (browsers
 * fall back across address families; a Node `listen` does not).
 */
export const DEFAULT_BIND_HOST = "127.0.0.1";

/**
 * Resolve the bind hostname from `env` (default `process.env`), defaulting to
 * {@link DEFAULT_BIND_HOST}. Refuses an all-interfaces host (`0.0.0.0` / `::` /
 * empty / their legacy spellings) unless {@link BIND_ALL_INTERFACES_ENV} is
 * explicitly enabled — the published Docker image sets it, since a container
 * must bind `0.0.0.0` to be reachable through `-p`. Throws (fail fast, loudly)
 * rather than silently binding wide open. The returned value is trimmed and
 * de-bracketed (an IPv6 literal is returned bare, e.g. `HOST=[::1]` → `::1`) so
 * detection, `listen()`, and the origin list all consume the same value;
 * `formatHostForUrl` re-adds the brackets wherever a URL is built.
 *
 * An explicit `HOST=localhost` is honored as typed — the single-family bind
 * described on {@link DEFAULT_BIND_HOST} is then the caller's choice, not ours.
 */
export function resolveBindHostname(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = (env.HOST ?? DEFAULT_BIND_HOST).trim();
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
