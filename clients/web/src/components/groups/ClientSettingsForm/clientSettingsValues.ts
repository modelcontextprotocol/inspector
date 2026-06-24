import type { ClientConfig } from "@inspector/core/client/types.js";

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
    clientSecret: idp.clientSecret,
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
  return values.issuer.trim() !== "" && values.clientId.trim() !== "";
}
