import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  getCimdClientMetadataUrlError,
  isAbsoluteHttpUrl,
} from "@inspector/core/client/config-parse.js";

/** Field-level error message for an issuer that is not an http(s) URL. */
export const ISSUER_URL_ERROR =
  "Must be an http(s) URL, like https://idp.example.com";
/** Field-level errors for a required field left blank while its feature is enabled. */
export const ISSUER_REQUIRED_ERROR =
  "Issuer is required when enterprise IdP configuration is enabled";
export const CLIENT_ID_REQUIRED_ERROR =
  "Client ID is required when enterprise IdP configuration is enabled";
export const CLIENT_METADATA_URL_REQUIRED_ERROR =
  "Metadata document URL is required when CIMD is enabled";

/** Field-level validation errors for the client settings form. */
export interface ClientSettingsErrors {
  issuer?: string;
  clientId?: string;
  clientMetadataUrl?: string;
}

export interface ValidateClientSettingsOptions {
  /**
   * Also flag required fields left blank. Off by default so inline (as-you-type)
   * validation only flags a field the user has actually filled in wrong; turned
   * on when a save/close is attempted so an incomplete config is surfaced rather
   * than silently dropped.
   */
  requireComplete?: boolean;
}

/**
 * Validation for the client settings form. By default only flags fields the
 * user has filled in wrong (a non-empty, non-http(s) issuer; a malformed CIMD
 * metadata URL). With `requireComplete`, also flags the required fields of an
 * enabled feature (EMA's issuer/clientId, CIMD's metadata URL) when they are
 * blank — used at save/close time so an enabled-but-incomplete config never
 * persists silently.
 */
export function validateClientSettings(
  values: ClientSettingsFormValues,
  options: ValidateClientSettingsOptions = {},
): ClientSettingsErrors {
  const errors: ClientSettingsErrors = {};

  if (values.emaEnabled) {
    const issuer = values.issuer.trim();
    if (issuer === "") {
      if (options.requireComplete) errors.issuer = ISSUER_REQUIRED_ERROR;
    } else if (!isAbsoluteHttpUrl(values.issuer)) {
      errors.issuer = ISSUER_URL_ERROR;
    }

    if (options.requireComplete && values.clientId.trim() === "") {
      errors.clientId = CLIENT_ID_REQUIRED_ERROR;
    }
  }

  if (values.cimdEnabled) {
    const url = values.clientMetadataUrl.trim();
    if (url === "") {
      if (options.requireComplete) {
        errors.clientMetadataUrl = CLIENT_METADATA_URL_REQUIRED_ERROR;
      }
    } else {
      const cimdError = getCimdClientMetadataUrlError(values.clientMetadataUrl);
      if (cimdError) {
        errors.clientMetadataUrl = cimdError;
      }
    }
  }

  return errors;
}

/** Form shape for install-level client settings (client.json). */
export interface ClientSettingsFormValues {
  emaEnabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  cimdEnabled: boolean;
  clientMetadataUrl: string;
}

export const EMPTY_CLIENT_SETTINGS: ClientSettingsFormValues = {
  emaEnabled: false,
  issuer: "",
  clientId: "",
  clientSecret: "",
  cimdEnabled: false,
  clientMetadataUrl: "",
};

export function clientConfigToFormValues(
  config: ClientConfig,
): ClientSettingsFormValues {
  const ema = config.enterpriseManagedAuth;
  const idp = ema?.idp;
  const cimd = config.cimd;

  return {
    emaEnabled: idp ? ema!.enabled !== false : false,
    issuer: idp?.issuer ?? "",
    clientId: idp?.clientId ?? "",
    clientSecret: idp?.clientSecret ?? "",
    cimdEnabled: cimd?.enabled === true,
    clientMetadataUrl: cimd?.clientMetadataUrl ?? "",
  };
}

function hasStoredIdpFields(values: ClientSettingsFormValues): boolean {
  return (
    values.issuer.trim() !== "" ||
    values.clientId.trim() !== "" ||
    values.clientSecret !== ""
  );
}

/** Serialize the full dialog state. POST replaces client.json wholesale. */
export function formValuesToClientConfig(
  values: ClientSettingsFormValues,
): ClientConfig {
  const result: ClientConfig = {
    cimd: {
      enabled: values.cimdEnabled,
      clientMetadataUrl: values.clientMetadataUrl.trim(),
    },
  };

  if (hasStoredIdpFields(values) || values.emaEnabled) {
    result.enterpriseManagedAuth = {
      enabled: values.emaEnabled,
      idp: {
        issuer: values.issuer.trim(),
        clientId: values.clientId.trim(),
        clientSecret: values.clientSecret,
      },
    };
  }

  return result;
}

/**
 * Skip the debounced persist while an enabled feature's required fields are
 * blank or invalid (EMA's issuer/clientId, CIMD's metadata URL). Defers to
 * {@link validateClientSettings} in `requireComplete` mode so the persist gate
 * and the close-time field errors can never drift: the same condition that
 * blocks the write also surfaces the field-level errors that explain why.
 */
export function canPersistClientSettingsDraft(
  values: ClientSettingsFormValues,
): boolean {
  return (
    Object.keys(validateClientSettings(values, { requireComplete: true }))
      .length === 0
  );
}
