import { describe, it, expect } from "vitest";
import {
  canPersistClientSettingsDraft,
  clientConfigToFormValues,
  EMPTY_CLIENT_SETTINGS,
  formValuesToClientConfig,
  ISSUER_URL_ERROR,
  validateClientSettings,
} from "./clientSettingsValues";

const emptyCimd = { cimdEnabled: false, clientMetadataUrl: "" };

describe("clientSettingsValues", () => {
  it("clientConfigToFormValues returns empty settings when there is no enterpriseManagedAuth", () => {
    // Exercises the `!idp` early return (line 24) via an absent EMA block.
    expect(clientConfigToFormValues({})).toEqual(EMPTY_CLIENT_SETTINGS);
  });

  it("clientConfigToFormValues maps enterpriseManagedAuth.idp", () => {
    expect(
      clientConfigToFormValues({
        enterpriseManagedAuth: {
          idp: {
            issuer: "https://idp.test",
            clientId: "cid",
            clientSecret: "sec",
          },
        },
      }),
    ).toEqual({
      emaEnabled: true,
      issuer: "https://idp.test",
      clientId: "cid",
      clientSecret: "sec",
      ...emptyCimd,
    });
  });

  it("clientConfigToFormValues preserves IdP fields when EMA is disabled", () => {
    expect(
      clientConfigToFormValues({
        enterpriseManagedAuth: {
          enabled: false,
          idp: {
            issuer: "https://idp.test",
            clientId: "cid",
            clientSecret: "sec",
          },
        },
      }),
    ).toEqual({
      emaEnabled: false,
      issuer: "https://idp.test",
      clientId: "cid",
      clientSecret: "sec",
      ...emptyCimd,
    });
  });

  it("clientConfigToFormValues maps cimd when EMA is absent", () => {
    expect(
      clientConfigToFormValues({
        cimd: {
          enabled: true,
          clientMetadataUrl: "https://example.com/cimd.json",
        },
      }),
    ).toEqual({
      emaEnabled: false,
      issuer: "",
      clientId: "",
      clientSecret: "",
      cimdEnabled: true,
      clientMetadataUrl: "https://example.com/cimd.json",
    });
  });

  it("clientConfigToFormValues preserves CIMD URL when disabled", () => {
    expect(
      clientConfigToFormValues({
        cimd: {
          enabled: false,
          clientMetadataUrl: "https://example.com/cimd.json",
        },
      }),
    ).toEqual({
      emaEnabled: false,
      issuer: "",
      clientId: "",
      clientSecret: "",
      cimdEnabled: false,
      clientMetadataUrl: "https://example.com/cimd.json",
    });
  });

  it("formValuesToClientConfig always writes the cimd block from the dialog", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toEqual({
      cimd: {
        enabled: false,
        clientMetadataUrl: "",
      },
    });
  });

  it("formValuesToClientConfig keeps IdP credentials when disabled", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "sec",
        ...emptyCimd,
      }),
    ).toEqual({
      enterpriseManagedAuth: {
        enabled: false,
        idp: {
          issuer: "https://idp.test",
          clientId: "cid",
          clientSecret: "sec",
        },
      },
      cimd: {
        enabled: false,
        clientMetadataUrl: "",
      },
    });
  });

  it("formValuesToClientConfig keeps CIMD URL when disabled", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        cimdEnabled: false,
        clientMetadataUrl: "https://example.com/cimd.json",
      }),
    ).toEqual({
      cimd: {
        enabled: false,
        clientMetadataUrl: "https://example.com/cimd.json",
      },
    });
  });

  it("formValuesToClientConfig serializes EMA and CIMD together", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: true,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "",
        cimdEnabled: true,
        clientMetadataUrl: "https://example.com/cimd.json",
      }),
    ).toEqual({
      enterpriseManagedAuth: {
        enabled: true,
        idp: {
          issuer: "https://idp.test",
          clientId: "cid",
          clientSecret: "",
        },
      },
      cimd: {
        enabled: true,
        clientMetadataUrl: "https://example.com/cimd.json",
      },
    });
  });

  it("formValuesToClientConfig trims issuer and clientId when enabled", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: true,
        issuer: "  https://idp.test  ",
        clientId: "  cid  ",
        clientSecret: "sec",
        ...emptyCimd,
      }),
    ).toEqual({
      enterpriseManagedAuth: {
        enabled: true,
        idp: {
          issuer: "https://idp.test",
          clientId: "cid",
          clientSecret: "sec",
        },
      },
      cimd: {
        enabled: false,
        clientMetadataUrl: "",
      },
    });
  });

  it("formValuesToClientConfig trims CIMD URL", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        cimdEnabled: true,
        clientMetadataUrl: "  https://example.com/cimd.json  ",
      }),
    ).toEqual({
      cimd: {
        enabled: true,
        clientMetadataUrl: "https://example.com/cimd.json",
      },
    });
  });

  it("canPersistClientSettingsDraft allows disabled or complete IdP fields", () => {
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toBe(true);
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: true,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toBe(true);
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: true,
        issuer: "",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toBe(false);
  });

  it("canPersistClientSettingsDraft requires CIMD URL when enabled", () => {
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        cimdEnabled: true,
        clientMetadataUrl: "",
      }),
    ).toBe(false);
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        cimdEnabled: true,
        clientMetadataUrl: "https://example.com/cimd.json",
      }),
    ).toBe(true);
  });

  it("canPersistClientSettingsDraft allows disabling CIMD while keeping the URL", () => {
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
        cimdEnabled: false,
        clientMetadataUrl: "https://example.com/cimd.json",
      }),
    ).toBe(true);
  });

  it("canPersistClientSettingsDraft blocks an invalid issuer URL", () => {
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: true,
        issuer: "not-a-url",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toBe(false);
  });

  it("validateClientSettings flags an invalid issuer URL", () => {
    expect(
      validateClientSettings({
        emaEnabled: true,
        issuer: "not-a-url",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toEqual({ issuer: ISSUER_URL_ERROR });
  });

  it("validateClientSettings passes a valid issuer URL", () => {
    expect(
      validateClientSettings({
        emaEnabled: true,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toEqual({});
  });

  it("validateClientSettings ignores an empty issuer", () => {
    expect(
      validateClientSettings({
        emaEnabled: true,
        issuer: "",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toEqual({});
  });

  it("validateClientSettings ignores issuer when EMA disabled", () => {
    expect(
      validateClientSettings({
        emaEnabled: false,
        issuer: "not-a-url",
        clientId: "cid",
        clientSecret: "",
        ...emptyCimd,
      }),
    ).toEqual({});
  });
});
