import {
  Accordion,
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
}

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

export function ClientSettingsForm({
  settings,
  expandedSections,
  onExpandedSectionsChange,
  onSettingsChange,
  emaIdpLoginState = "none",
  onEmaIdpLogout,
}: ClientSettingsFormProps) {
  function patch(partial: Partial<ClientSettingsFormValues>) {
    onSettingsChange((prev) => ({ ...prev, ...partial }));
  }

  const errors = validateClientSettings(settings);

  const showIdpSession =
    settings.emaEnabled &&
    settings.issuer.trim() !== "" &&
    emaIdpLoginState !== "none";

  return (
    <Accordion
      multiple
      value={expandedSections}
      onChange={(value) =>
        onExpandedSectionsChange(value as ClientSettingsSection[])
      }
      variant="separated"
    >
      <Accordion.Item value="ema">
        <Accordion.Control>Enterprise-Managed Authorization</Accordion.Control>
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
                  error={errors.issuer}
                  rightSectionPointerEvents="auto"
                  rightSection={
                    settings.issuer ? (
                      <ClearButton onClick={() => patch({ issuer: "" })} />
                    ) : null
                  }
                />
                <TextInput
                  label="Client ID"
                  description="Client id registered with your enterprise IdP."
                  value={settings.clientId}
                  onChange={(e) => patch({ clientId: e.currentTarget.value })}
                  rightSectionPointerEvents="auto"
                  rightSection={
                    settings.clientId ? (
                      <ClearButton onClick={() => patch({ clientId: "" })} />
                    ) : null
                  }
                />
                <TextInput
                  label="Client Secret"
                  description="Client secret for your enterprise IdP (if required)."
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
                          <Badge w="fit-content" color="green" variant="light">
                            Signed in
                          </Badge>
                          <HintText>
                            Your enterprise IdP session is active. Connecting to
                            EMA-enabled MCP servers will not prompt for IdP
                            login until you sign out or the session expires.
                          </HintText>
                        </>
                      ) : emaIdpLoginState === "expired" ? (
                        <>
                          <Badge w="fit-content" color="yellow" variant="light">
                            Session expired
                          </Badge>
                          <HintText>
                            Your cached IdP session has expired. The next
                            connect to an EMA-enabled server will prompt for IdP
                            login.
                          </HintText>
                        </>
                      ) : (
                        <HintText>
                          Not signed in to your enterprise IdP. Connecting to an
                          EMA-enabled MCP server will open IdP login.
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
        <Accordion.Control>OAuth Client ID Metadata Document</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Checkbox
              label="Use Client ID Metadata Document"
              description="When the authorization server supports CIMD, Inspector uses this metadata document URL as the client id. The server fetches and verifies the document during OAuth."
              checked={settings.cimdEnabled}
              onChange={(e) => patch({ cimdEnabled: e.currentTarget.checked })}
            />
            {settings.cimdEnabled && (
              <>
                <HintText>
                  The metadata document must be served over HTTPS and list this
                  redirect URI:{" "}
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
                  error={errors.clientMetadataUrl}
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
  );
}
