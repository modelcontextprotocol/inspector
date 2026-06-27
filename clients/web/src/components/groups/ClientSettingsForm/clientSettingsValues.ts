import type { ClientConfig } from "@inspector/core/client/types.js";

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
    if (!values.issuer.trim() || !values.clientId.trim()) return false;
  }
  if (values.cimdEnabled) {
    if (!values.clientMetadataUrl.trim()) return false;
  }
  return true;
}
