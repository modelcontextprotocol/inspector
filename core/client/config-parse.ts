/**
 * Browser-safe client.json parse/validate (no Node file I/O).
 */

import { z } from "zod";
import type { ClientConfig } from "./types.js";

/**
 * True when `value` (trimmed) is an absolute `http:`/`https:` URL with a real
 * host. An OAuth IdP issuer is always http(s), so other parseable schemes
 * (`mailto:`, `foo:bar`, `javascript:`) are rejected rather than deferred to a
 * later connect failure. Beyond "parses + http(s)", the host must actually look
 * like a host — a dotted domain or IP, or `localhost` — so bare or degenerate
 * values the URL parser still accepts (`https://foo`, `https://.`, `https://..`,
 * `https://example`) are rejected too.
 */
export function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isRealHost(url.hostname);
}

/**
 * A hostname the URL parser produced that we accept as an actual host:
 * - `localhost` (common in dev),
 * - an IPv6 literal (arrives bracketed, e.g. `[::1]`),
 * - otherwise a dotted name / IPv4 with at least two non-empty labels — which
 *   rejects single-label (`foo`), bare-dot (`.`, `..`) and empty-label
 *   (`a..b`, `.a`, `a.`) hosts. An empty hostname splits to `[""]` and is
 *   rejected here too (http(s) URLs can't reach this with an empty host).
 */
function isRealHost(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (hostname.startsWith("[")) return hostname.endsWith("]");
  const labels = hostname.split(".");
  return labels.length >= 2 && labels.every((label) => label !== "");
}

const HttpUrlStringSchema = z
  .string()
  .min(1)
  .superRefine((val, ctx) => {
    const trimmed = val.trim();
    if (!isAbsoluteHttpUrl(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid URL: "${trimmed}" — must be an http(s) URL (e.g. https://idp.example.com)`,
      });
    }
  });

/** Field-level error when a CIMD metadata URL is not a parseable http(s) URL. */
export const CIMD_METADATA_URL_INVALID_ERROR =
  "Must be a valid URL, like https://example.com/oauth/client.json";

/**
 * Field-level error when a CIMD metadata URL is neither HTTPS nor served from
 * one of the exempt loopback literals. The message names the exemption rather
 * than saying only "must use HTTPS", so a developer pointing the field at a
 * local fixture is told which spellings work instead of concluding that nothing
 * local can (the same phrasing lesson as the token-endpoint notice in
 * `core/auth/oauthUx.ts`).
 */
export const CIMD_METADATA_URL_HTTPS_ERROR =
  "CIMD client metadata URL must use HTTPS, except on localhost, 127.0.0.1 or [::1]";

/**
 * Hosts for which a plain `http:` CIMD metadata URL is accepted.
 *
 * SEP-991 expects HTTPS in production for a real reason: a CIMD `client_id` is
 * a URL the authorization server dereferences, and over plain HTTP the document
 * it gets back is attacker-modifiable in transit. Loopback is the documented
 * exception to exactly that reasoning — there is no network segment to sit on —
 * which is why the SDK exempts these same three literals from its token-endpoint
 * TLS assertion, and why `core/auth/cimd.ts` already notes that an
 * already-stored `client_id` may be an `http://` URL "used by local dev/test
 * metadata servers". Without this, the runtime tolerated a value the config
 * validation would not let anyone enter, and CIMD could not be driven against
 * any fixture in this repo (#2305).
 *
 * ⚠️ This is the SDK's own list, matched member for member — not the broader
 * `isLoopbackHost` in `core/node/hostUrl.ts`, which imports `node:net` and so
 * cannot be reached from this browser-safe module. The SDK's
 * `assertSecureTokenEndpoint` tests `url.hostname` against exactly
 * `localhost` / `127.0.0.1` / `[::1]` (plus a `::1` arm `URL.hostname` never
 * produces, since it brackets IPv6 literals). Keeping the two identical is what
 * stops them disagreeing about one URL.
 *
 * ⚠️ **The comparison is against the WHATWG-canonicalized `URL.hostname`, so it
 * covers alternate spellings of these three *addresses*, not three input
 * strings.** `http://127.1/…`, `http://2130706433/…`, `http://0x7f.0.0.1/…` and
 * `http://[0:0:0:0:0:0:0:1]/…` all canonicalize into the set and are accepted;
 * so is a root-anchored `http://127.0.0.1./…`, which WHATWG strips the dot from
 * for IP literals but *not* for `localhost.`. That is deliberate on both counts:
 * the security argument is about the address the request actually reaches, and
 * every one of these is the loopback interface. It is also exactly what the SDK
 * does — it canonicalizes through `new URL` the same way — so an alias accepted
 * here is an alias the SDK accepts too.
 */
const CIMD_HTTP_EXEMPT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when a plain-`http:` CIMD metadata URL on this host is acceptable. Takes
 * the already-canonicalized `URL.hostname`, never a raw authority or a
 * `host:port` — passing an unparsed string would compare the wrong thing and
 * silently reject every alias above. Not exported: the only caller is the
 * validator below, and the exemption is exercised through it rather than
 * through a second public surface that could drift from it.
 */
function isCimdHttpExemptHost(hostname: string): boolean {
  return CIMD_HTTP_EXEMPT_HOSTS.has(hostname);
}

/** Field-level error when a CIMD metadata URL has no path segment. */
export const CIMD_METADATA_URL_PATH_ERROR =
  "Must include a path (not the site root), like https://example.com/oauth/client.json";

/**
 * Inline / form validation for a non-empty CIMD client metadata URL.
 * Returns undefined when the value is valid; empty strings are not flagged here
 * (required-field gating lives in {@link canPersistClientSettingsDraft}).
 */
export function getCimdClientMetadataUrlError(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!isAbsoluteHttpUrl(trimmed)) {
    return CIMD_METADATA_URL_INVALID_ERROR;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && !isCimdHttpExemptHost(url.hostname)) {
      return CIMD_METADATA_URL_HTTPS_ERROR;
    }
    if (url.pathname === "/" || url.pathname === "") {
      return CIMD_METADATA_URL_PATH_ERROR;
    }
  } catch {
    return CIMD_METADATA_URL_INVALID_ERROR;
  }
  return undefined;
}

function refineCimdMetadataUrl(
  val: string,
  ctx: z.RefinementCtx,
  required: boolean,
): void {
  const trimmed = val.trim();
  if (trimmed === "") {
    if (required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CIMD client metadata URL is required when CIMD is enabled",
      });
    }
    return;
  }
  const error = getCimdClientMetadataUrlError(trimmed);
  if (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error,
    });
  }
}

const CimdConfigSchema = z
  .object({
    enabled: z.boolean(),
    clientMetadataUrl: z.string(),
  })
  .superRefine((data, ctx) => {
    refineCimdMetadataUrl(data.clientMetadataUrl, ctx, data.enabled === true);
  });

const EnterpriseManagedAuthIdpConfigSchema = z.object({
  issuer: HttpUrlStringSchema,
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
});

const ClientConfigSchema = z.object({
  enterpriseManagedAuth: z
    .object({
      enabled: z.boolean().optional(),
      idp: EnterpriseManagedAuthIdpConfigSchema,
    })
    .optional(),
  cimd: CimdConfigSchema.optional(),
});

/**
 * Parse and validate unknown JSON into {@link ClientConfig}.
 * @throws {z.ZodError} when shape is invalid
 */
export function parseClientConfig(raw: unknown): ClientConfig {
  return ClientConfigSchema.parse(raw);
}

/** Canonical JSON serialization for client.json (matches backend store-io format). */
export function serializeClientConfig(config: ClientConfig): string {
  return JSON.stringify(config, null, 2);
}

/** Human-readable message for a failed client.json load (parse or transport). */
export function formatClientConfigLoadError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (issue) {
      const field =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "config";
      return `${field}: ${issue.message}`;
    }
    return "Invalid client.json shape";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
