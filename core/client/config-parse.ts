/**
 * Browser-safe client.json parse/validate (no Node file I/O).
 */

import { z } from "zod";
import type { ClientConfig } from "./types.js";

function refineAbsoluteUrl(val: string, ctx: z.RefinementCtx): void {
  const trimmed = val.trim();
  if (!URL.canParse(trimmed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid URL: "${trimmed}" — must be an absolute URL (e.g. https://idp.example.com)`,
    });
  }
}

const HttpUrlStringSchema = z.string().min(1).superRefine((val, ctx) => {
  refineAbsoluteUrl(val, ctx);
});

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
  refineAbsoluteUrl(trimmed, ctx);
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CIMD client metadata URL must use HTTPS",
      });
    }
    if (url.pathname === "/" || url.pathname === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "CIMD client metadata URL must include a path (not the site root)",
      });
    }
  } catch {
    // refineAbsoluteUrl already reported invalid URL
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
