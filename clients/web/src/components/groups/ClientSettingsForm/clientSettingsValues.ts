import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  getCimdClientMetadataUrlError,
  isAbsoluteHttpUrl,
} from "@inspector/core/client/config-parse.js";

/** Field-level error message for an issuer that is not an http(s) URL. */
export const ISSUER_URL_ERROR =
  "Must be an http(s) URL, like https://idp.example.com";

/** Field-level validation errors for the client settings form. */
export interface ClientSettingsErrors {
  issuer?: string;
  clientMetadataUrl?: string;
}

/**
 * Inline validation for the client settings form. Only flags fields that the
 * user has actually filled in — empty required fields are gated by
 * {@link canPersistClientSettingsDraft} rather than surfaced as errors.
 */
export function validateClientSettings(
  values: ClientSettingsFormValues,
): ClientSettingsErrors {
  const errors: ClientSettingsErrors = {};
  if (
    values.emaEnabled &&
    values.issuer.trim() !== "" &&
    !isAbsoluteHttpUrl(values.issuer)
  ) {
    errors.issuer = ISSUER_URL_ERROR;
  }
  if (values.cimdEnabled && values.clientMetadataUrl.trim() !== "") {
    const cimdError = getCimdClientMetadataUrlError(values.clientMetadataUrl);
    if (cimdError) {
      errors.clientMetadataUrl = cimdError;
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

/** Skip debounced persist while required fields are blank for enabled features. */
export function canPersistClientSettingsDraft(
  values: ClientSettingsFormValues,
): boolean {
  if (values.emaEnabled) {
    if (values.issuer.trim() === "" || values.clientId.trim() === "")
      return false;
  }
  if (values.cimdEnabled) {
    if (!values.clientMetadataUrl.trim()) return false;
  }
  // Defer to validateClientSettings so the persist gate and inline field errors
  // can never drift — invalid values are never sent to the backend.
  return Object.keys(validateClientSettings(values)).length === 0;
}
