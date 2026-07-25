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

/** Field-level error when a CIMD metadata URL is not HTTPS. */
export const CIMD_METADATA_URL_HTTPS_ERROR =
  "CIMD client metadata URL must use HTTPS";

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
    if (url.protocol !== "https:") {
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
