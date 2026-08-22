/**
 * Node-only client.json persistence with OS keychain for IdP clientSecret.
 */

import {
  secretStoreGetStrict,
  secretStoreIsDurable,
  SecretStoreUnavailableError,
  type SecretStore,
} from "../auth/node/secret-store.js";
import { SECRET_FIELD_IDP_CLIENT_SECRET } from "../auth/secret-fields.js";
import {
  deleteStoreFile,
  parseStore,
  readStoreFile,
  serializeStore,
  writeStoreFile,
} from "../storage/store-io.js";
import { parseClientConfig } from "./config-parse.js";
import type { ClientConfig } from "./types.js";
import {
  CLIENT_KEYCHAIN_ID,
  extractSecretsFromClientConfig,
  hasClientPlaintextSecret,
  mergeSecretsIntoClientConfig,
} from "./secrets.js";

async function readIdpSecretFromKeychain(
  secretStore: SecretStore,
): Promise<Record<string, string>> {
  const secret = await secretStore.get(
    CLIENT_KEYCHAIN_ID,
    SECRET_FIELD_IDP_CLIENT_SECRET,
  );
  if (!secret) return {};
  return { [SECRET_FIELD_IDP_CLIENT_SECRET]: secret };
}

async function migrateClientPlaintextSecret(
  filePath: string,
  config: ClientConfig,
  secretStore: SecretStore,
): Promise<ClientConfig> {
  const { stripped, secrets } = extractSecretsFromClientConfig(config);
  const value = secrets[SECRET_FIELD_IDP_CLIENT_SECRET];
  if (!value) return config;

  try {
    // Strict: `get` answers `null` for an unreadable store as well as a
    // missing entry, and the branch below *writes* on `null` — so a
    // transient failure would overwrite a newer stored secret with the older
    // `client.json` copy, inverting keychain-wins. A throw is caught below
    // and leaves the plaintext file untouched for the next attempt.
    const existing = await secretStoreGetStrict(
      secretStore,
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
    );
    if (existing === null) {
      await secretStore.set(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
        value,
      );
    }
    // Only strip the plaintext once it is somewhere that outlives us.
    // Against a session-scoped store (the container fallback added in
    // #1950) this migration would trade a secret that survives restarts
    // for one that dies with the process — and it runs on an ordinary
    // read, so merely loading the app would destroy it. The value is
    // still loaded into the store above, so this session behaves
    // normally; only the delete is withheld.
    if (!(await secretStoreIsDurable(secretStore))) return config;
    await writeStoreFile(filePath, serializeStore(stripped));
    return stripped;
  } catch (err) {
    if (err instanceof SecretStoreUnavailableError) {
      return config;
    }
    throw err;
  }
}

/** Read client.json from disk and rehydrate IdP clientSecret from the keychain. */
export async function readClientConfigStore(
  filePath: string,
  secretStore: SecretStore,
): Promise<ClientConfig> {
  const raw = await readStoreFile(filePath);
  if (raw === null) {
    return {};
  }

  let config = parseClientConfig(parseStore(raw));
  if (hasClientPlaintextSecret(config)) {
    config = await migrateClientPlaintextSecret(filePath, config, secretStore);
  }

  const secrets = await readIdpSecretFromKeychain(secretStore);
  return mergeSecretsIntoClientConfig(config, secrets);
}

/** Validate, strip IdP clientSecret to keychain, and write client.json. */
export async function writeClientConfigStore(
  filePath: string,
  body: unknown,
  secretStore: SecretStore,
): Promise<void> {
  const validated = parseClientConfig(body);
  const { stripped, secrets } = extractSecretsFromClientConfig(validated);
  const idpSecret = secrets[SECRET_FIELD_IDP_CLIENT_SECRET];
  if (idpSecret) {
    await secretStore.set(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
      idpSecret,
    );
  } else {
    await secretStore.delete(
      CLIENT_KEYCHAIN_ID,
      SECRET_FIELD_IDP_CLIENT_SECRET,
    );
  }
  await writeStoreFile(filePath, serializeStore(stripped));
}

/** Remove client.json and the install-level IdP secret from the keychain. */
export async function deleteClientConfigStore(
  filePath: string,
  secretStore: SecretStore,
): Promise<void> {
  await deleteStoreFile(filePath);
  await secretStore.delete(CLIENT_KEYCHAIN_ID, SECRET_FIELD_IDP_CLIENT_SECRET);
}
