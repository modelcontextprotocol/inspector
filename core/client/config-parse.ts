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
