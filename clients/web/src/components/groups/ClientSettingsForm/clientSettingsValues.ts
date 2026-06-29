import type { ClientConfig } from "@inspector/core/client/types.js";
import { isAbsoluteHttpUrl } from "@inspector/core/client/config-parse.js";

/** Field-level error message for an issuer that is not an http(s) URL. */
export const ISSUER_URL_ERROR =
  "Must be an http(s) URL, like https://idp.example.com";
/** Field-level errors for a required IdP field left blank while EMA is enabled. */
export const ISSUER_REQUIRED_ERROR =
  "Issuer is required when enterprise IdP configuration is enabled";
export const CLIENT_ID_REQUIRED_ERROR =
  "Client ID is required when enterprise IdP configuration is enabled";

/** Field-level validation errors for the client settings form. */
export interface ClientSettingsErrors {
  issuer?: string;
  clientId?: string;
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
 * user has filled in wrong (a non-empty, non-http(s) issuer). With
 * `requireComplete`, also flags the required IdP fields (issuer, clientId) when
 * they are blank — used at save/close time so an enabled-but-incomplete EMA
 * config never persists silently.
 */
export function validateClientSettings(
  values: ClientSettingsFormValues,
  options: ValidateClientSettingsOptions = {},
): ClientSettingsErrors {
  const errors: ClientSettingsErrors = {};
  if (!values.emaEnabled) return errors;

  const issuer = values.issuer.trim();
  if (issuer === "") {
    if (options.requireComplete) errors.issuer = ISSUER_REQUIRED_ERROR;
  } else if (!isAbsoluteHttpUrl(values.issuer)) {
    errors.issuer = ISSUER_URL_ERROR;
  }

  if (options.requireComplete && values.clientId.trim() === "") {
    errors.clientId = CLIENT_ID_REQUIRED_ERROR;
  }

  return errors;
}

/** Form shape for install-level client settings (client.json). */
export interface ClientSettingsFormValues {
  emaEnabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export const EMPTY_CLIENT_SETTINGS: ClientSettingsFormValues = {
  emaEnabled: false,
  issuer: "",
  clientId: "",
  clientSecret: "",
};

export function clientConfigToFormValues(
  config: ClientConfig,
): ClientSettingsFormValues {
  const ema = config.enterpriseManagedAuth;
  const idp = ema?.idp;
  if (!idp) {
    return { ...EMPTY_CLIENT_SETTINGS };
  }
  return {
    emaEnabled: ema.enabled !== false,
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret ?? "",
  };
}

function hasStoredIdpFields(values: ClientSettingsFormValues): boolean {
  return (
    values.issuer.trim() !== "" ||
    values.clientId.trim() !== "" ||
    values.clientSecret !== ""
  );
}

export function formValuesToClientConfig(
  values: ClientSettingsFormValues,
): ClientConfig {
  if (!hasStoredIdpFields(values)) {
    return {};
  }

  const idp = {
    issuer: values.issuer.trim(),
    clientId: values.clientId.trim(),
    clientSecret: values.clientSecret,
  };

  return {
    enterpriseManagedAuth: {
      enabled: values.emaEnabled,
      idp,
    },
  };
}

/**
 * Skip the debounced persist while EMA is enabled but its required IdP fields
 * are blank or invalid. Defers to {@link validateClientSettings} in
 * `requireComplete` mode so the persist gate and the close-time field errors can
 * never drift: the same condition that blocks the write also surfaces the
 * field-level errors that explain why.
 */
export function canPersistClientSettingsDraft(
  values: ClientSettingsFormValues,
): boolean {
  if (!values.emaEnabled) return true;
  return (
    Object.keys(validateClientSettings(values, { requireComplete: true }))
      .length === 0
  );
}
