import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { EmaIdpLoginState } from "@inspector/core/auth/ema/idpSession.js";
import {
  validateClientSettings,
  type ClientSettingsFormValues,
  type OAuthRegistrationError,
} from "./clientSettingsValues.js";

export type ClientSettingsSection = "ema" | "cimd";

export interface ClientSettingsFormProps {
  settings: ClientSettingsFormValues;
  expandedSections: ClientSettingsSection[];
  onExpandedSectionsChange: (sections: ClientSettingsSection[]) => void;
  onSettingsChange: (
    settings:
      | ClientSettingsFormValues
      | ((prev: ClientSettingsFormValues) => ClientSettingsFormValues),
  ) => void;
  emaIdpLoginState?: EmaIdpLoginState;
  onEmaIdpLogout?: () => void;
  /**
   * Force all field errors to show, including required-but-blank fields (EMA's
   * issuer/clientId, CIMD's metadata URL). The parent sets this when a
   * save/close is attempted with an incomplete or invalid config, so nothing is
   * silently dropped without explanation.
   */
  revealErrors?: boolean;
  /**
   * Last Dynamic Client Registration rejection from an authorization server
   * (SEP-837), surfaced so the user can see *why* DCR failed and adjust (switch
   * to CIMD, fix the redirect URI). Cleared by the parent on the next attempt.
   */
  registrationError?: OAuthRegistrationError;
}

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

/** Human-readable one-liner for an RFC 7591 DCR rejection. */
function registrationRejectionSummary(error: OAuthRegistrationError): string {
  const parts = [
    error.error,
    error.errorDescription,
    error.status ? `HTTP ${error.status}` : undefined,
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(" — ")
    : "The authorization server rejected client registration.";
}

export function ClientSettingsForm({
  settings,
  expandedSections,
  onExpandedSectionsChange,
  onSettingsChange,
  emaIdpLoginState = "none",
  onEmaIdpLogout,
  revealErrors = false,
  registrationError,
}: ClientSettingsFormProps) {
  function patch(partial: Partial<ClientSettingsFormValues>) {
    onSettingsChange((prev) => ({ ...prev, ...partial }));
  }

  // Defer the issuer error until the field has been blurred so it doesn't nag
  // mid-typing (e.g. while "https:/…" is still incomplete). Once touched it
  // updates live, so the error clears as soon as a valid URL is entered. The
  // parent forces all errors on via `revealErrors` when a close/save is
  // attempted with an incomplete or invalid config — including the
  // required-but-blank fields, which inline validation otherwise leaves silent.
  // The persist gate (canPersistClientSettingsDraft) validates independently, so
  // an incomplete/invalid config is never written regardless of these flags.
  const [issuerTouched, setIssuerTouched] = useState(false);
  const [clientMetadataUrlTouched, setClientMetadataUrlTouched] =
    useState(false);

  // Inline errors flag only a filled-in-wrong field (issuer URL); the
  // require-complete set adds the blank-required fields surfaced on reveal.
  const inlineErrors = validateClientSettings(settings);
  const revealedErrors = validateClientSettings(settings, {
    requireComplete: true,
  });
  const showIssuerError = revealErrors
    ? revealedErrors.issuer
    : issuerTouched
      ? inlineErrors.issuer
      : undefined;
  const showClientIdError = revealErrors ? revealedErrors.clientId : undefined;
  const showClientMetadataUrlError = revealErrors
    ? revealedErrors.clientMetadataUrl
    : clientMetadataUrlTouched
      ? inlineErrors.clientMetadataUrl
      : undefined;

  const showIdpSession =
    settings.emaEnabled &&
    settings.issuer.trim() !== "" &&
    emaIdpLoginState !== "none";

  return (
    <Stack gap="md">
      {registrationError && (
        <Alert
          color="red"
          variant="light"
          title="Client registration was rejected"
        >
          <Stack gap={4}>
            <Text size="sm">
              {registrationRejectionSummary(registrationError)}
            </Text>
            <HintText>
              Inspector registers as a native client (application_type
              &quot;native&quot;) so authorization servers accept its localhost
              redirect URI (SEP-837). If the server still rejects Dynamic Client
              Registration, use a Client ID Metadata Document (below) or a
              preregistered client instead.
            </HintText>
          </Stack>
        </Alert>
      )}
      <Accordion
        multiple
        value={expandedSections}
        onChange={(value) =>
          onExpandedSectionsChange(value as ClientSettingsSection[])
        }
        variant="separated"
      >
        <Accordion.Item value="ema">
          <Accordion.Control>
            Enterprise-Managed Authorization
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Checkbox
                label="Enable enterprise IdP configuration"
                description="Enterprise-managed authorization signs you in through your organization's IdP instead of each MCP server's own OAuth login. Enable enterprise-managed authorization on participating MCP server's settings."
                checked={settings.emaEnabled}
                onChange={(e) => patch({ emaEnabled: e.currentTarget.checked })}
              />
              {settings.emaEnabled && (
                <>
                  <HintText>
                    Register this redirect URI with your IdP:{" "}
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/oauth/callback`
                      : "http://localhost:6274/oauth/callback"}
                  </HintText>
                  <TextInput
                    label="Issuer"
                    description="Your enterprise IdP issuer URL."
                    value={settings.issuer}
                    onChange={(e) => patch({ issuer: e.currentTarget.value })}
                    onBlur={() => setIssuerTouched(true)}
                    error={showIssuerError}
                    rightSectionPointerEvents="auto"
                    rightSection={
                      settings.issuer ? (
                        <ClearButton onClick={() => patch({ issuer: "" })} />
                      ) : null
                    }
                  />
                  <TextInput
                    label="IdP Client ID"
                    description="Client id registered with your enterprise IdP (EMA legs 1–2) — not the per-server resource authorization server credentials, which go in Server Settings → OAuth Settings."
                    value={settings.clientId}
                    onChange={(e) => patch({ clientId: e.currentTarget.value })}
                    error={showClientIdError}
                    rightSectionPointerEvents="auto"
                    rightSection={
                      settings.clientId ? (
                        <ClearButton onClick={() => patch({ clientId: "" })} />
                      ) : null
                    }
                  />
                  <TextInput
                    label="IdP Client Secret"
                    description="Client secret for your enterprise IdP, if required (EMA legs 1–2) — not the per-server resource authorization server credentials, which go in Server Settings → OAuth Settings."
                    type="password"
                    value={settings.clientSecret}
                    onChange={(e) =>
                      patch({ clientSecret: e.currentTarget.value })
                    }
                    rightSectionPointerEvents="auto"
                    rightSection={
                      settings.clientSecret ? (
                        <ClearButton
                          onClick={() => patch({ clientSecret: "" })}
                        />
                      ) : null
                    }
                  />
                  {settings.issuer.trim() !== "" && (
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Stack gap={4} flex={1}>
                        <Text size="sm" fw={500}>
                          IdP sign-in
                        </Text>
                        {emaIdpLoginState === "logged_in" ? (
                          <>
                            <Badge
                              w="fit-content"
                              color="green"
                              variant="light"
                            >
                              Signed in
                            </Badge>
                            <HintText>
                              Your enterprise IdP session is active. Connecting
                              to EMA-enabled MCP servers will not prompt for IdP
                              login until you sign out or the session expires.
                            </HintText>
                          </>
                        ) : emaIdpLoginState === "expired" ? (
                          <>
                            <Badge
                              w="fit-content"
                              color="yellow"
                              variant="light"
                            >
                              Session expired
                            </Badge>
                            <HintText>
                              Your cached IdP session has expired. The next
                              connect to an EMA-enabled server will prompt for
                              IdP login.
                            </HintText>
                          </>
                        ) : (
                          <HintText>
                            Not signed in to your enterprise IdP. Connecting to
                            an EMA-enabled MCP server will open IdP login.
                          </HintText>
                        )}
                      </Stack>
                      {showIdpSession && onEmaIdpLogout ? (
                        <Button
                          variant="light"
                          color="red"
                          size="compact-sm"
                          onClick={onEmaIdpLogout}
                        >
                          Sign out
                        </Button>
                      ) : null}
                    </Group>
                  )}
                </>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="cimd">
          <Accordion.Control>
            OAuth Client ID Metadata Document
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <HintText>
                CIMD is the preferred client-identity mechanism in the
                2026-07-28 spec. Dynamic Client Registration still works and is
                used by default when CIMD is off, but it is now deprecated in
                favor of CIMD (SEP-991).
              </HintText>
              <Checkbox
                label="Use Client ID Metadata Document"
                description="When the authorization server supports CIMD, Inspector uses this metadata document URL as the client id. The server fetches and verifies the document during OAuth."
                checked={settings.cimdEnabled}
                onChange={(e) =>
                  patch({ cimdEnabled: e.currentTarget.checked })
                }
              />
              {settings.cimdEnabled && (
                <>
                  <HintText>
                    The metadata document must be served over HTTPS and list
                    this redirect URI:{" "}
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/oauth/callback`
                      : "http://localhost:6274/oauth/callback"}
                  </HintText>
                  <TextInput
                    label="Client ID metadata document URL"
                    description="Public HTTPS URL of your OAuth client metadata JSON document."
                    value={settings.clientMetadataUrl}
                    onChange={(e) =>
                      patch({ clientMetadataUrl: e.currentTarget.value })
                    }
                    onBlur={() => setClientMetadataUrlTouched(true)}
                    error={showClientMetadataUrlError}
                    rightSectionPointerEvents="auto"
                    rightSection={
                      settings.clientMetadataUrl ? (
                        <ClearButton
                          onClick={() => patch({ clientMetadataUrl: "" })}
                        />
                      ) : null
                    }
                  />
                </>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
