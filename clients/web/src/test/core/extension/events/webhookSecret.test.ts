import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEBHOOK_SECRET_BYTES,
  generateWebhookSecret,
  isWebhookSecret,
  MASKED_WEBHOOK_SECRET,
  REDACTED_WEBHOOK_SECRET,
  redactSubscribeSecret,
  redactWebhookSecrets,
} from "@inspector/core/extension/events/webhookSecret.js";

/**
 * The webhook signing secret (#3031): CSPRNG generation in the shape the spec
 * requires, the same shape check a server applies, and the masking that keeps
 * it out of everything the Inspector shows or records.
 */

function decodedLength(secret: string): number {
  return atob(secret.slice("whsec_".length)).length;
}

describe("generateWebhookSecret", () => {
  it("draws 32 random bytes by default, as whsec_ + base64", () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(decodedLength(secret)).toBe(DEFAULT_WEBHOOK_SECRET_BYTES);
    expect(isWebhookSecret(secret)).toBe(true);
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret()),
    );
    expect(seen.size).toBe(50);
  });

  it("uses the random source it is given, for every byte", () => {
    const secret = generateWebhookSecret(24, (bytes) => bytes.fill(0xff));
    expect(atob(secret.slice(6))).toBe("\xff".repeat(24));
  });

  it.each([23, 65, 24.5])("refuses %s bytes", (bytes) => {
    expect(() => generateWebhookSecret(bytes)).toThrow(RangeError);
  });

  it("accepts both bounds", () => {
    expect(decodedLength(generateWebhookSecret(24))).toBe(24);
    expect(decodedLength(generateWebhookSecret(64))).toBe(64);
  });
});

describe("isWebhookSecret", () => {
  it.each([
    ["a non-string", 42],
    ["no prefix", btoa("x".repeat(32))],
    ["non-base64", `whsec_${"!".repeat(44)}`],
    ["a ragged length", `whsec_${"A".repeat(43)}`],
    ["too few bytes", `whsec_${btoa("x".repeat(23))}`],
    ["too many bytes", `whsec_${btoa("x".repeat(65))}`],
  ])("refuses %s", (_label, value) => {
    expect(isWebhookSecret(value)).toBe(false);
  });

  it.each([24, 25, 26, 64])("accepts %s bytes, padded or not", (bytes) => {
    expect(isWebhookSecret(`whsec_${btoa("x".repeat(bytes))}`)).toBe(true);
  });
});

describe("masking", () => {
  it("shows nothing of the secret", () => {
    expect(MASKED_WEBHOOK_SECRET).toMatch(/^whsec_•+$/);
  });

  it("redacts every secret in free text and leaves other text alone", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret(64);
    const text = JSON.stringify({ delivery: { secret: a }, note: `and ${b}.` });
    const redacted = redactWebhookSecrets(text);
    expect(redacted).not.toContain(a);
    expect(redacted).not.toContain(b.slice(6));
    expect(JSON.parse(redacted)).toEqual({
      delivery: { secret: REDACTED_WEBHOOK_SECRET },
      note: `and ${REDACTED_WEBHOOK_SECRET}.`,
    });
    expect(redactWebhookSecrets("no secret here")).toBe("no secret here");
  });

  it("masks an events/subscribe secret in a copy, leaving the original", () => {
    const secret = generateWebhookSecret();
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "events/subscribe",
      params: {
        name: "t",
        delivery: { mode: "webhook", url: "https://x.example", secret },
      },
    };
    const recorded = redactSubscribeSecret(message);
    expect(recorded.params.delivery).toEqual({
      mode: "webhook",
      url: "https://x.example",
      secret: REDACTED_WEBHOOK_SECRET,
    });
    expect(message.params.delivery.secret).toBe(secret);
  });

  it.each([
    ["another method", { method: "events/poll", params: { delivery: {} } }],
    ["no params", { method: "events/subscribe" }],
    ["no delivery", { method: "events/subscribe", params: { name: "t" } }],
    [
      "a null delivery",
      { method: "events/subscribe", params: { delivery: null } },
    ],
    [
      "a delivery without a secret",
      { method: "events/subscribe", params: { delivery: { url: "u" } } },
    ],
  ])("returns %s unchanged", (_label, message) => {
    expect(redactSubscribeSecret(message)).toBe(message);
  });
});
