/**
 * Resolves and validates the hostname the web server (prod backend + Vite dev
 * server) binds to. Enforces the localhost-only default so the Inspector can't
 * accidentally expose its process-spawning proxy to the whole network.
 *
 * Shared by `web-server-config.ts` (the Node backend) and `vite.config.ts` (the
 * dev server) so both bind points enforce the same policy.
 */

/** Env var that opts into binding all network interfaces (see {@link resolveBindHostname}). */
export const BIND_ALL_INTERFACES_ENV = "DANGEROUSLY_BIND_ALL_INTERFACES";

/**
 * Hostnames that bind *every* network interface rather than just loopback:
 * `0.0.0.0` (IPv4 wildcard), `::` (IPv6 wildcard), and the empty string (Node's
 * `listen()` treats "" as the unspecified/all-interfaces address). Binding any
 * of these makes the backend — which can spawn local processes and reach MCP
 * servers on behalf of the browser — reachable from the local network, which is
 * the exact exposure DNS-rebinding attacks exploit.
 */
const ALL_INTERFACES_HOSTS = new Set(["0.0.0.0", "::", ""]);

/** True when `host` binds all interfaces rather than loopback only. */
export function isAllInterfacesHost(host: string): boolean {
  return ALL_INTERFACES_HOSTS.has(host.trim().toLowerCase());
}

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
 * `localhost`. Refuses an all-interfaces host (`0.0.0.0` / `::` / empty) unless
 * {@link BIND_ALL_INTERFACES_ENV} is explicitly enabled — the published Docker
 * image sets it, since a container must bind `0.0.0.0` to be reachable through
 * `-p`. Throws (fail fast, loudly) rather than silently binding wide open.
 */
export function resolveBindHostname(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = env.HOST ?? "localhost";
  if (isAllInterfacesHost(host) && !isEnabled(env[BIND_ALL_INTERFACES_ENV])) {
    throw new Error(
      `Refusing to bind HOST="${host}": this exposes the MCP Inspector to your ` +
        `entire network, and its backend can spawn local processes and connect ` +
        `to MCP servers on your behalf — the exposure DNS-rebinding attacks ` +
        `target. Bind a loopback host (localhost / 127.0.0.1) instead. To ` +
        `override — only inside an isolated container or trusted network — set ` +
        `${BIND_ALL_INTERFACES_ENV}=true.`,
    );
  }
  return host;
}
