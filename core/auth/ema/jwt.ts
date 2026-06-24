function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Best-effort `exp` (epoch seconds) from an unparsed JWT payload. */
export function jwtExpiresAtMs(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]!)) as { exp?: number };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isJwtExpired(
  token: string,
  skewMs = 60_000,
  nowMs = Date.now(),
): boolean {
  const exp = jwtExpiresAtMs(token);
  if (exp === undefined) return false;
  return nowMs >= exp - skewMs;
}

/** True when `token` has the three-segment JWT shape (no signature verification). */
export function isJwtFormat(token: string): boolean {
  const parts = token.split(".");
  return (
    parts.length === 3 &&
    parts[0]!.length > 0 &&
    parts[1]!.length > 0 &&
    parts[2] !== undefined
  );
}

/** Best-effort decode of JWT header and payload for display (no verification). */
export function decodeJwtPayload(token: string):
  | {
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
    }
  | undefined {
  if (!isJwtFormat(token)) return undefined;
  const parts = token.split(".");
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]!)) as Record<
      string,
      unknown
    >;
    const payload = JSON.parse(decodeBase64Url(parts[1]!)) as Record<
      string,
      unknown
    >;
    return { header, payload };
  } catch {
    return undefined;
  }
}
