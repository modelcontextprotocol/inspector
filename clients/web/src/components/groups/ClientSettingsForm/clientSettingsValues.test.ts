import { describe, it, expect } from "vitest";
import {
  canPersistClientSettingsDraft,
  clientConfigToFormValues,
  EMPTY_CLIENT_SETTINGS,
  formValuesToClientConfig,
} from "./clientSettingsValues";

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
    });
  });

  it("formValuesToClientConfig keeps IdP credentials when disabled", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "sec",
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
    });
  });

  it("formValuesToClientConfig omits block when disabled with no stored fields", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
      }),
    ).toEqual({});
  });

  it("formValuesToClientConfig trims issuer and clientId when enabled", () => {
    expect(
      formValuesToClientConfig({
        emaEnabled: true,
        issuer: "  https://idp.test  ",
        clientId: "  cid  ",
        clientSecret: "sec",
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
    });
  });

  it("canPersistClientSettingsDraft allows disabled or complete IdP fields", () => {
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: false,
        issuer: "",
        clientId: "",
        clientSecret: "",
      }),
    ).toBe(true);
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: true,
        issuer: "https://idp.test",
        clientId: "cid",
        clientSecret: "",
      }),
    ).toBe(true);
    expect(
      canPersistClientSettingsDraft({
        emaEnabled: true,
        issuer: "",
        clientId: "cid",
        clientSecret: "",
      }),
    ).toBe(false);
  });
});
