import type { ClientConfig } from "@inspector/core/client/types.js";
import { isAbsoluteUrl } from "@inspector/core/client/config-parse.js";

/** Field-level error message for an issuer that is not an absolute URL. */
export const ISSUER_URL_ERROR =
  "Must be an absolute URL, like https://idp.example.com";

/** Field-level validation errors for the client settings form. */
export interface ClientSettingsErrors {
  issuer?: string;
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
    !isAbsoluteUrl(values.issuer)
  ) {
    errors.issuer = ISSUER_URL_ERROR;
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

/** Skip debounced persist while EMA is enabled but required IdP fields are blank. */
export function canPersistClientSettingsDraft(
  values: ClientSettingsFormValues,
): boolean {
  if (!values.emaEnabled) return true;
  if (values.issuer.trim() === "" || values.clientId.trim() === "")
    return false;
  // Never send an invalid issuer to the backend — the inline field error guides
  // the user instead of a raw validation failure toast.
  return isAbsoluteUrl(values.issuer);
}
