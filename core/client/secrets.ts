/**
 * Strip/merge install-level IdP client secrets for client.json ↔ keychain.
 * Browser-safe — no Node keychain imports.
 */

import { SECRET_FIELD_IDP_CLIENT_SECRET } from "../auth/secret-fields.js";
import type { ClientConfig } from "./types.js";

/** Keychain namespace for install-level client config (not a server catalog id). */
export const CLIENT_KEYCHAIN_ID = "client";

export function hasClientPlaintextSecret(config: ClientConfig): boolean {
  const secret = config.enterpriseManagedAuth?.idp?.clientSecret;
  return typeof secret === "string" && secret.length > 0;
}

/**
 * Lift IdP `clientSecret` off the config blob. The stripped shape is what
 * lands on disk; the secret map is written to the OS keychain.
 */
export function extractSecretsFromClientConfig(config: ClientConfig): {
  stripped: ClientConfig;
  secrets: Record<string, string>;
} {
  const secrets: Record<string, string> = {};
  const ema = config.enterpriseManagedAuth;
  if (!ema?.idp?.clientSecret) {
    return { stripped: config, secrets };
  }

  const { clientSecret, ...idpRest } = ema.idp;
  secrets[SECRET_FIELD_IDP_CLIENT_SECRET] = clientSecret;
  return {
    stripped: {
      ...config,
      enterpriseManagedAuth: {
        ...ema,
        idp: idpRest,
      },
    },
    secrets,
  };
}

/** Merge keychain secrets back into a stripped on-disk client config. */
export function mergeSecretsIntoClientConfig(
  config: ClientConfig,
  secrets: Record<string, string>,
): ClientConfig {
  const idpSecret = secrets[SECRET_FIELD_IDP_CLIENT_SECRET];
  const ema = config.enterpriseManagedAuth;
  if (!idpSecret || !ema?.idp) {
    return config;
  }
  return {
    ...config,
    enterpriseManagedAuth: {
      ...ema,
      idp: {
        ...ema.idp,
        clientSecret: idpSecret,
      },
    },
  };
}
