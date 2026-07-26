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
 * Exact spellings of the all-interfaces (unspecified) address. `0.0.0.0` (IPv4
 * wildcard), `::` and its expansions (IPv6 wildcard), the IPv4-mapped wildcard,
 * and the empty string (Node's `listen()` treats "" as the unspecified address)
 * all bind *every* interface. {@link isAllInterfacesHost} also catches the
 * legacy numeric spellings the OS resolver still folds to `0.0.0.0`.
 */
const ALL_INTERFACES_LITERALS = new Set([
  "",
  "0.0.0.0",
  "::",
  "0:0:0:0:0:0:0:0",
  "::ffff:0.0.0.0",
  "::ffff:0:0",
]);

/**
 * Parse one dotted-address part (or a bare address) the way the C `inet_aton`
 * resolver does — decimal, `0`-prefixed octal, and `0x`-prefixed hex are all
 * accepted. Returns `NaN` for anything non-numeric (e.g. a hostname label).
 */
function parseAddressPart(part: string): number {
  if (/^0x[0-9a-f]+$/.test(part)) return parseInt(part, 16);
  if (/^[0-9]+$/.test(part)) return parseInt(part, 10);
  return NaN;
}

/**
 * True when `value` is an all-zero IPv4 address in any legacy spelling the OS
 * still binds as the `0.0.0.0` wildcard: the bare integer `0`, `0x0`, dotted
 * `0.0.0.0`, `000.000.000.000`, `0x0.0.0.0`, etc. (Node/`inet_aton` accept all
 * of these.) Guards the near-miss bypasses of the literal set above.
 */
function isAllZeroIpv4(value: string): boolean {
  if (value === "") return false;
  const parts = value.split(".");
  if (parts.length > 4) return false;
  return parts.every((part) => parseAddressPart(part) === 0);
}

/** True when `host` binds all interfaces rather than loopback only. */
export function isAllInterfacesHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return ALL_INTERFACES_LITERALS.has(normalized) || isAllZeroIpv4(normalized);
}

/**
 * Wrap an IPv6 literal in brackets so it's a valid URL authority
 * (`http://[::1]:6274`), and pass every other host (loopback names, IPv4,
 * hostnames, already-bracketed IPv6) through unchanged. Shared by the origin
 * allow-list, the startup banner, and the sandbox URL so all three format a
 * bound IPv6 host the same way.
 */
export function formatHostForUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("[") || !h.includes(":")) return h;
  return `[${h}]`;
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
 * `localhost`. Refuses an all-interfaces host (`0.0.0.0` / `::` / empty / their
 * legacy spellings) unless {@link BIND_ALL_INTERFACES_ENV} is explicitly
 * enabled — the published Docker image sets it, since a container must bind
 * `0.0.0.0` to be reachable through `-p`. Throws (fail fast, loudly) rather than
 * silently binding wide open. The returned value is trimmed so detection and
 * the value handed to `listen()` agree.
 */
export function resolveBindHostname(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = (env.HOST ?? "localhost").trim();
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
