/**
 * The webhook signing secret (SEP-3415, Webhook security, #3031): generating
 * it, checking its shape, and keeping it out of everything the Inspector shows
 * or records.
 *
 * **Generated, never typed.** The client supplies `delivery.secret` and the
 * server never generates one. The spec says client SDKs SHOULD generate it from
 * a CSPRNG and SHOULD NOT expose an interface that encourages hand-picked
 * values, so the Inspector offers no text field for it: the value comes from
 * {@link generateWebhookSecret}, and the user can copy or regenerate it, never
 * edit it.
 *
 * **Shape.** A Standard Webhooks symmetric secret: the literal `whsec_` and the
 * base64 of 24 to 64 random bytes. A server MUST reject anything else with
 * `InvalidParams`, so {@link isWebhookSecret} checks the same rule before the
 * request is sent rather than leaving the user to read it off an error.
 *
 * **Masked everywhere it would be seen.** The secret is the credential a
 * receiver verifies deliveries with, so the UI shows {@link MASKED_WEBHOOK_SECRET}
 * in its place, and the Protocol and Network tabs record the `events/subscribe`
 * request with the value replaced by {@link REDACTED_WEBHOOK_SECRET}
 * ({@link redactWebhookSecrets}, {@link redactSubscribeSecret}). Only the
 * request actually sent carries it.
 *
 * Browser-safe: `crypto.getRandomValues` and `btoa`/`atob` are globals in every
 * browser and in Node 22, so this runs unchanged in the web bundle and the CLI.
 */

import { EVENTS_SUBSCRIBE_METHOD } from "./constants.js";

export const WEBHOOK_SECRET_PREFIX = "whsec_";
/** The spec's bounds on the decoded secret, in bytes. */
export const MIN_WEBHOOK_SECRET_BYTES = 24;
export const MAX_WEBHOOK_SECRET_BYTES = 64;
/** What {@link generateWebhookSecret} draws when not told otherwise. */
export const DEFAULT_WEBHOOK_SECRET_BYTES = 32;

/** What the UI shows in place of a secret: the prefix, and nothing of it. */
export const MASKED_WEBHOOK_SECRET = `${WEBHOOK_SECRET_PREFIX}••••••••••••`;
/** What a recorded request or body carries in place of a secret. */
export const REDACTED_WEBHOOK_SECRET = `${WEBHOOK_SECRET_PREFIX}[REDACTED]`;

/** Fills a byte array with cryptographically strong random values. */
export type RandomBytesSource = (bytes: Uint8Array) => void;

const cryptoRandom: RandomBytesSource = (bytes) => {
  crypto.getRandomValues(bytes);
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A fresh `whsec_` secret from the platform CSPRNG. `random` is injectable for
 * deterministic tests only; the default is `crypto.getRandomValues`.
 */
export function generateWebhookSecret(
  byteLength: number = DEFAULT_WEBHOOK_SECRET_BYTES,
  random: RandomBytesSource = cryptoRandom,
): string {
  if (
    !Number.isInteger(byteLength) ||
    byteLength < MIN_WEBHOOK_SECRET_BYTES ||
    byteLength > MAX_WEBHOOK_SECRET_BYTES
  ) {
    throw new RangeError(
      `A webhook secret is ${MIN_WEBHOOK_SECRET_BYTES} to ${MAX_WEBHOOK_SECRET_BYTES} bytes (got ${byteLength}).`,
    );
  }
  const bytes = new Uint8Array(byteLength);
  random(bytes);
  return `${WEBHOOK_SECRET_PREFIX}${toBase64(bytes)}`;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Whether `value` is `whsec_` + base64 of 24 to 64 bytes (the server's rule). */
export function isWebhookSecret(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(WEBHOOK_SECRET_PREFIX)) {
    return false;
  }
  const body = value.slice(WEBHOOK_SECRET_PREFIX.length);
  if (!BASE64.test(body) || body.length % 4 !== 0) return false;
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  const bytes = (body.length / 4) * 3 - padding;
  return bytes >= MIN_WEBHOOK_SECRET_BYTES && bytes <= MAX_WEBHOOK_SECRET_BYTES;
}

/**
 * Every `whsec_…` value in free text, replaced by
 * {@link REDACTED_WEBHOOK_SECRET}. Matches the prefix and the base64 alphabet
 * that follows it, so it works on a JSON body, a log line or an error message
 * alike, without parsing any of them.
 */
export function redactWebhookSecrets(text: string): string {
  return text.includes(WEBHOOK_SECRET_PREFIX)
    ? text.replace(/whsec_[A-Za-z0-9+/]+=*/g, REDACTED_WEBHOOK_SECRET)
    : text;
}

/**
 * A JSON-RPC message as the Protocol tab should record it: an
 * `events/subscribe` request with `params.delivery.secret` replaced, anything
 * else returned as is. A copy — the message the transport sends is untouched.
 */
export function redactSubscribeSecret<
  T extends { method?: string; params?: unknown },
>(message: T): T {
  if (message.method !== EVENTS_SUBSCRIBE_METHOD) return message;
  const params = message.params;
  if (params === null || typeof params !== "object") return message;
  const delivery = (params as { delivery?: unknown }).delivery;
  if (delivery === null || typeof delivery !== "object") return message;
  if (!("secret" in delivery)) return message;
  return {
    ...message,
    params: {
      ...params,
      delivery: { ...delivery, secret: REDACTED_WEBHOOK_SECRET },
    },
  };
}
