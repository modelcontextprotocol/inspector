/**
 * Resolves and validates the hostname the web server (prod backend + Vite dev
 * server) binds to. Enforces the localhost-only default so the Inspector can't
 * accidentally expose its process-spawning proxy to the whole network.
 *
 * Shared by `web-server-config.ts` (the Node backend) and `vite.config.ts` (the
 * dev server) so both bind points enforce the same policy.
 */

import { isIPv6 } from "node:net";
import { stripBrackets } from "../../../core/node/hostUrl.ts";

/** Env var that opts into binding all network interfaces (see {@link resolveBindHostname}). */
export const BIND_ALL_INTERFACES_ENV = "DANGEROUSLY_BIND_ALL_INTERFACES";

/**
 * Canonical spellings of the all-interfaces (unspecified) address. Every IPv6
 * wildcard spelling (`::`, `::0`, `0:0:…:0`, `::0.0.0.0`, …) canonicalizes to
 * `::` and the IPv4-mapped wildcard to `::ffff:0:0` (see {@link canonicalizeIpv6}),
 * so those two entries cover the whole IPv6 family; `0.0.0.0` is the IPv4
 * wildcard and `""` is Node's `listen()` unspecified address. All bind *every*
 * interface. {@link isAllInterfacesHost} additionally folds the legacy IPv4
 * spellings the OS resolver still binds as `0.0.0.0`.
 */
const ALL_INTERFACES_LITERALS = new Set(["", "0.0.0.0", "::", "::ffff:0:0"]);

/**
 * Canonicalize an IPv6 literal via the WHATWG URL serializer, which compresses
 * zero-runs — so `::0`, `0::0`, `::0.0.0.0`, and the fully-expanded
 * `0000:…:0000` all collapse to `::`, and `::ffff:0.0.0.0` → `::ffff:0:0`. This
 * is what lets a small literal set catch every all-zero IPv6 spelling rather
 * than only the handful written out. Non-IPv6 input passes through unchanged.
 *
 * The zone index (`%eth0`) is stripped first: `net.isIPv6` accepts it but
 * `new URL()` rejects a zone id outright (even `%25`-encoded), so passing it
 * through would throw. The zone is irrelevant to *which* address this is, so
 * dropping it is correct for detection — `::%eth0` still canonicalizes to `::`.
 * (The caller keeps the zone on the value it returns for `listen()`.)
 */
function canonicalizeIpv6(value: string): string {
  if (!isIPv6(value)) return value;
  const [address] = value.split("%");
  return new URL(`http://[${address}]`).hostname.slice(1, -1);
}

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
 * `0.0.0.0`, `000.000.000.000`, `0x0.0.0.0`, and the short forms `0.0` / `0.0.0`
 * (Node/`inet_aton` accept 1–4 parts; `parseAddressPart`'s `[0-9]+` branch does
 * double duty for decimal and `0`-prefixed octal). Guards the near-miss
 * bypasses of the literal set above. The `> 4` reject is intentional — 1–3
 * parts are valid `inet_aton` spellings, so this is deliberately NOT
 * `parts.length === 4`. Called from {@link isAllInterfacesHost} with any
 * normalized host, so it may receive an IPv6 literal (`::1`) — the dot-split
 * yields a single non-numeric part → `NaN` → `false`, which is correct.
 */
function isAllZeroIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length > 4) return false;
  return parts.every((part) => parseAddressPart(part) === 0);
}

/** True when `host` binds all interfaces rather than loopback only. */
export function isAllInterfacesHost(host: string): boolean {
  const normalized = canonicalizeIpv6(stripBrackets(host.trim().toLowerCase()));
  return ALL_INTERFACES_LITERALS.has(normalized) || isAllZeroIpv4(normalized);
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
    throw new Error(
      `Refusing to bind HOST="${host}": this exposes the MCP Inspector to your ` +
        `entire network, and its backend can spawn local processes and connect ` +
        `to MCP servers on your behalf — the exposure DNS-rebinding attacks ` +
        `target. Bind a loopback host (localhost / 127.0.0.1) instead. To ` +
        `override — only inside an isolated container or trusted network — set ` +
        `${BIND_ALL_INTERFACES_ENV}=true.`,
    );
  }
  return stripBrackets(host);
}
