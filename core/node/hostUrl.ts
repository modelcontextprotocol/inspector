/**
 * Format a bind host for use inside a URL authority. An IPv6 literal must be
 * bracketed (`http://[::1]:6274`); every other host — loopback names, IPv4,
 * hostnames, already-bracketed IPv6 — passes through unchanged. Shared by the
 * web origin allow-list, the startup banner, the sandbox URL, and the CLI
 * deep-link so a bound IPv6 host is formatted the same way everywhere.
 */
export function formatHostForUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("[") || !h.includes(":")) return h;
  return `[${h}]`;
}
