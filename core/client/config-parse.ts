/**
 * Browser-safe client.json parse/validate (no Node file I/O).
 */

import { z } from "zod";
import type { ClientConfig } from "./types.js";

/**
 * True when `value` (trimmed) is an absolute `http:`/`https:` URL. An OAuth IdP
 * issuer is always http(s), so other parseable schemes (`mailto:`, `foo:bar`,
 * `javascript:`) are rejected rather than deferred to a later connect failure.
 */
export function isAbsoluteHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!URL.canParse(trimmed)) return false;
  const { protocol } = new URL(trimmed);
  return protocol === "https:" || protocol === "http:";
}

const HttpUrlStringSchema = z.string().min(1).superRefine((val, ctx) => {
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
export function getCimdClientMetadataUrlError(value: string): string | undefined {
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
