import {
  Badge,
  Button,
  Code,
  Flex,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  ClientCapabilities,
  DiscoverResult,
  InitializeResult,
  ProtocolEra,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import type { ServerType } from "@inspector/core/mcp/types.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/mcp/modernTaskSchemas.js";
import { getSkillsExtension } from "@inspector/core/mcp/skills.js";
import type { OAuthClientRegistrationKind } from "@inspector/core/auth/types.js";
import {
  CapabilityItem,
  type CapabilityKey,
} from "../../elements/CapabilityItem/CapabilityItem";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { EraBadge } from "../../elements/EraBadge/EraBadge";
import { isModernEra } from "../../elements/EraBadge/eraUtils";
import { OAuthTokenField } from "./OAuthTokenField";

export interface OAuthDetails {
  protocol: "standard" | "ema";
  authorized: boolean;
  clientId?: string;
  clientRegistrationKind?: OAuthClientRegistrationKind;
  authUrl?: string;
  scopes?: string[];
  accessToken?: string;
  /**
   * OIDC `id_token` from the stored token set, when the authorization server
   * returned one. Shown for inspection only — the MCP authorization spec is
   * plain OAuth 2.1 and the Inspector never treats this as a credential
   * (#2019). Absent when the token set carries none, so no empty row renders.
   */
  idToken?: string;
  /** EMA only — install-level IdP session for legs 1–2. */
  idpSession?: "none" | "logged_in" | "expired";
}

export interface ConnectionInfoContentProps {
  initializeResult: InitializeResult;
  /**
   * Whether the server actually reported `serverInfo`. When false (a modern
   * server that omitted the optional `_meta` stamp), `initializeResult`'s name is
   * a client-side catalog fallback, so the Server Implementation section renders
   * "not reported" rather than presenting the inferred name as server-sent — the
   * exact fact a user opens this modal to check (#1772). Defaults to `true`
   * (server-reported), which is the norm and what fixtures with a real
   * `serverInfo` want.
   */
  serverInfoReported?: boolean;
  clientCapabilities: ClientCapabilities;
  transport: ServerType;
  /**
   * Protocol era negotiated with the server (SEP §7.8). `"modern"` connections
   * are sessionless and learn capabilities from `server/discover`; `"legacy"`
   * (or undefined, on a plain legacy connect) use the initialize handshake.
   * (#1626)
   */
  protocolEra?: ProtocolEra;
  /**
   * The `server/discover` result on a modern connection — supported versions,
   * capabilities, and extensions learned up front. Undefined on legacy. (#1626)
   */
  discoverResult?: DiscoverResult;
  oauth?: OAuthDetails;
  onClearOAuth?: () => void;
}

const ValueText = Text.withProps({
  size: "sm",
  fw: 600,
});

// Shown for Name/Version when the server didn't report `serverInfo` — an em dash
// plus an explicit note so the client-side catalog fallback is never mistaken
// for a value the server sent. Exported so tests/stories assert against it
// rather than re-typing the copy.
export const SERVER_INFO_NOT_REPORTED_LABEL = "— (not reported by server)";

const SectionHeading = Title.withProps({
  // `order: 3` (not 5) keeps the heading level one below the modal's `h2`
  // `Modal.Title`, so the outline doesn't skip a level (axe `heading-order`);
  // `size: "h5"` preserves the original small visual size.
  order: 3,
  size: "h5",
  variant: "section",
});

// Long OAuth values (client id, auth URL). The `wrapping` variant wraps the
// value onto multiple lines instead of leaving it in a horizontally-scrolling
// `Code` block — that keeps the whole value visible and removes a scroll region
// that would otherwise need its own keyboard access (axe
// `scrollable-region-focusable`).
const ValueCode = Code.withProps({ variant: "wrapping" });

// One declared sub-option of an extension. Mirrors `CapabilityItem`'s ✓/✗ row
// rather than reusing it: that element's `capability` prop is the closed union
// of spec capability keys, and widening it to accept an arbitrary extension
// sub-option name would collapse it to `string` and lose the typo protection
// the union buys every other caller.
const SubOptionRow = Group.withProps({ gap: "xs", wrap: "nowrap" });

const SubOptionMark = Text.withProps({ fw: 600 });

const ClearOAuthButton = Button.withProps({
  variant: "subtle",
  color: "red",
  size: "compact-xs",
});

function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

function formatProtocol(protocol: OAuthDetails["protocol"]): string {
  return protocol === "ema" ? "Enterprise-managed" : "Standard";
}

function formatIdpSession(
  session: NonNullable<OAuthDetails["idpSession"]>,
): string {
  switch (session) {
    case "logged_in":
      return "Signed in";
    case "expired":
      return "Session expired";
    default:
      return "Not signed in";
  }
}

function formatClientRegistrationKind(
  kind: OAuthClientRegistrationKind,
): string {
  switch (kind) {
    case "static":
      return "Static (preregistered)";
    case "dcr":
      return "Dynamic (DCR)";
    case "cimd":
      return "Client ID Metadata (CIMD)";
  }
}

// `isModernEra` / `formatEra` are shared with the Protocol view via the
// EraBadge element (single source of truth for the legacy/modern distinction).

// The session concept is HTTP-only: modern HTTP connections are sessionless (no
// `Mcp-Session-Id`, nothing to DELETE on disconnect) while a legacy HTTP
// connection may carry a server session. stdio has no HTTP session at all, so
// the row is not applicable there.
function formatSession(
  era: ProtocolEra | undefined,
  transport: ServerType,
): string {
  if (transport === "stdio") return "N/A (stdio)";
  return isModernEra(era) ? "Sessionless" : "Session-based";
}

// The extension identifiers in an `extensions` capability map (SEP-2133), one
// per rendered row, or a single em dash when none are present. Works for either
// side's map: the server's negotiated `capabilities.extensions` (present on both
// eras via `getServerCapabilities()`) or the Inspector's own advertised
// `clientCapabilities.extensions`. (#1740)
//
// A list rather than a comma-joined string (#2234): an identifier is ~30
// characters and two of them wrap mid-name in a half-width column, which is
// what made the joined form hard to read at a glance.
function formatExtensions(
  extensions: Record<string, unknown> | undefined,
): string[] {
  const keys = extensions ? Object.keys(extensions) : [];
  return keys.length > 0 ? keys : ["\u2014"];
}

const SERVER_CAPABILITY_KEYS: CapabilityKey[] = [
  "tools",
  "resources",
  "prompts",
  "logging",
  "completions",
  "tasks",
  "experimental",
];

const CLIENT_CAPABILITY_KEYS: CapabilityKey[] = [
  "roots",
  "sampling",
  "elicitation",
  "experimental",
];

export const CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL =
  "Clear OAuth state and disconnect";

/**
 * Server capabilities the modern (2026-07-28) era expresses as a negotiated
 * *extension* rather than a top-level `capabilities` key. `tasks` is the only
 * one today: SEP-2663 moved task support to
 * `capabilities.extensions["io.modelcontextprotocol/tasks"]`, so a modern
 * tasks-capable server left the Tasks row showing a red ✗ while the very same
 * extension id was listed under "Server Extensions" two sections below
 * (#1887). Keyed the same way `InspectorClient.isTasksExtensionNegotiated()`
 * gates the Tasks tab, so the checkmark and the tab agree.
 */
const MODERN_EXTENSION_BACKED_CAPABILITIES: Partial<
  Record<CapabilityKey, string>
> = {
  tasks: TASKS_EXTENSION_KEY,
};

function isCapabilityPresent(
  capabilities: Record<string, unknown>,
  key: CapabilityKey,
): boolean {
  return key in capabilities && capabilities[key] != null;
}

function getCapabilityEntries(
  capabilities: Record<string, unknown>,
  knownKeys: CapabilityKey[],
): { capability: CapabilityKey; supported: boolean }[] {
  return knownKeys.map((key) => ({
    capability: key,
    supported: isCapabilityPresent(capabilities, key),
  }));
}

/**
 * Server-side capability entries. Same presence rule as the client column,
 * plus the modern extension fallback above — gated on the negotiated era so a
 * legacy connection is still judged purely on its `initialize` capabilities.
 */
function getServerCapabilityEntries(
  capabilities: ServerCapabilities,
  era: ProtocolEra | undefined,
): { capability: CapabilityKey; supported: boolean }[] {
  const modern = isModernEra(era);
  return SERVER_CAPABILITY_KEYS.map((key) => {
    const extensionKey = MODERN_EXTENSION_BACKED_CAPABILITIES[key];
    const viaExtension =
      modern &&
      extensionKey !== undefined &&
      capabilities.extensions?.[extensionKey] != null;
    return {
      capability: key,
      supported: isCapabilityPresent(capabilities, key) || viaExtension,
    };
  });
}

export function ConnectionInfoContent({
  initializeResult,
  serverInfoReported = true,
  clientCapabilities,
  transport,
  protocolEra,
  discoverResult,
  oauth,
  onClearOAuth,
}: ConnectionInfoContentProps) {
  const { serverInfo, protocolVersion, capabilities, instructions } =
    initializeResult;
  // `undefined` when the server declared no Skills extension, which is what
  // hides the section below — an absent extension has no sub-flags to report.
  const skillsExtension = getSkillsExtension(capabilities);

  // Only trust `serverInfo` when the server actually reported it; otherwise the
  // name is a catalog fallback. Both rows `?.trim()` before the `||` (not `??`)
  // so a reported-but-blank name/version — empty, whitespace-only ("   "), or a
  // non-conforming runtime-absent field — reads as unknown ("—") rather than a
  // blank row. The optional chain preserves the prior tolerance of a missing
  // field (the field is typed non-null, but a non-conforming server can omit
  // it); whitespace-only is the same class InspectorView's
  // `resolveHeaderServerInfo` handles for the header (#1774). `initialize`
  // mandates the fields, not non-empty values. Stays faithful: the fallback is
  // "—", never a borrowed catalog name.
  const displayName = serverInfoReported
    ? serverInfo.name?.trim() || "—"
    : SERVER_INFO_NOT_REPORTED_LABEL;
  const displayVersion = serverInfoReported
    ? serverInfo.version?.trim() || "—"
    : SERVER_INFO_NOT_REPORTED_LABEL;

  const serverCaps = getServerCapabilityEntries(capabilities, protocolEra);
  const clientCaps = getCapabilityEntries(
    clientCapabilities,
    CLIENT_CAPABILITY_KEYS,
  );

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <SectionHeading>Server Implementation</SectionHeading>
        <SimpleGrid cols={2}>
          <Text size="sm">Name</Text>
          <ValueText>{displayName}</ValueText>

          <Text size="sm">Version</Text>
          <ValueText>{displayVersion}</ValueText>

          <Text size="sm">Protocol</Text>
          <ValueText>{protocolVersion || "—"}</ValueText>

          <Text size="sm">Transport</Text>
          <Badge variant="outline">{transport}</Badge>

          <Text size="sm">Era</Text>
          <EraBadge era={protocolEra} />

          <Text size="sm">Session</Text>
          <ValueText>{formatSession(protocolEra, transport)}</ValueText>
        </SimpleGrid>
      </Stack>

      {discoverResult && (
        <Stack gap="xs">
          <SectionHeading>Discovery</SectionHeading>
          <SimpleGrid cols={2}>
            <Text size="sm">Supported versions</Text>
            <ValueText>
              {discoverResult.supportedVersions.length > 0
                ? discoverResult.supportedVersions.join(", ")
                : "—"}
            </ValueText>
          </SimpleGrid>
        </Stack>
      )}

      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <SectionHeading>Server Capabilities</SectionHeading>
          {serverCaps.map((cap) => (
            <CapabilityItem
              key={cap.capability}
              capability={cap.capability}
              supported={cap.supported}
            />
          ))}
        </Stack>
        <Stack gap="xs">
          <SectionHeading>Client Capabilities</SectionHeading>
          {clientCaps.map((cap) => (
            <CapabilityItem
              key={cap.capability}
              capability={cap.capability}
              supported={cap.supported}
            />
          ))}
        </Stack>
      </SimpleGrid>

      {/* Extensions (SEP-2133) shown for both eras: the server's from its
          negotiated capabilities, the Inspector's from what it advertised
          (the Advertised Extensions setting). Mirrors the server/client
          capability columns above. (#1740) */}
      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <SectionHeading>Server Extensions</SectionHeading>
          {/* A plain `Text`, not the bold `ValueText`: these sections list
              *items*, the way the capability columns above do, rather than
              giving the value half of a label/value pair. Bolding them made
              them read as emphasized answers to a question the section never
              asks, and set them in a different font from the checklist rows
              they sit directly beneath. */}
          {formatExtensions(capabilities.extensions).map((extension) => (
            <Text key={extension}>{extension}</Text>
          ))}
        </Stack>
        <Stack gap="xs">
          <SectionHeading>Client Advertised Extensions</SectionHeading>
          {formatExtensions(clientCapabilities.extensions).map((extension) => (
            <Text key={extension}>{extension}</Text>
          ))}
        </Stack>
      </SimpleGrid>

      {/* Skills (SEP-2640). The "Server Extensions" row above already names the
          identifier, so repeating it here would say nothing: what this section
          adds is the extension's SUB-OPTIONS, which a flat list of keys cannot
          show. `directoryRead` is the only one SEP-2640 defines, and whether a
          server declared it is the fact a server author opens this modal to
          check — it gates `resources/directory/read` (#2234). Rendered with the
          same ✓/✗ vocabulary as the capability columns above so it reads as the
          same kind of claim. */}
      {skillsExtension && (
        <Stack gap="xs">
          <SectionHeading>Skills Extension Options</SectionHeading>
          <SubOptionRow
            data-testid="skills-directory-read"
            data-supported={skillsExtension.directoryRead}
          >
            <SubOptionMark c={skillsExtension.directoryRead ? "green" : "red"}>
              {skillsExtension.directoryRead ? "\u2713" : "\u2717"}
            </SubOptionMark>
            <Text>
              Directory read — <Code>resources/directory/read</Code>
            </Text>
          </SubOptionRow>
        </Stack>
      )}

      {instructions && (
        <Stack gap="xs">
          <SectionHeading>Server Instructions</SectionHeading>
          {/* Cap the instructions block so a long server prompt scrolls
              inside the section instead of pushing the OAuth section and
              modal chrome off-screen. */}
          <ScrollArea.Autosize mah={280}>
            <ContentViewer
              block={{ type: "text", text: instructions }}
              copyable
            />
          </ScrollArea.Autosize>
        </Stack>
      )}

      {oauth && (
        <Stack gap="xs">
          <SectionHeading>OAuth Details</SectionHeading>
          <Stack gap="xs">
            <SimpleGrid cols={2}>
              <Text size="sm">Protocol</Text>
              <ValueText>{formatProtocol(oauth.protocol)}</ValueText>

              <Text size="sm">Status</Text>
              <Badge
                variant="outline"
                color={oauth.authorized ? "green" : "gray"}
              >
                {oauth.authorized ? "Authorized" : "Not authorized"}
              </Badge>
            </SimpleGrid>
            {oauth.clientId && (
              <SimpleGrid cols={2}>
                <Text size="sm">Client ID</Text>
                <ValueCode>{oauth.clientId}</ValueCode>
              </SimpleGrid>
            )}
            {oauth.clientRegistrationKind && (
              <SimpleGrid cols={2}>
                <Text size="sm">Client registration</Text>
                <ValueText>
                  {formatClientRegistrationKind(oauth.clientRegistrationKind)}
                </ValueText>
              </SimpleGrid>
            )}
            {oauth.protocol === "ema" && oauth.idpSession && (
              <SimpleGrid cols={2}>
                <Text size="sm">IdP session</Text>
                <ValueText>{formatIdpSession(oauth.idpSession)}</ValueText>
              </SimpleGrid>
            )}
            {oauth.authUrl && (
              <SimpleGrid cols={2}>
                <Text size="sm">Auth URL</Text>
                <ValueCode>{oauth.authUrl}</ValueCode>
              </SimpleGrid>
            )}
            {oauth.scopes && oauth.scopes.length > 0 && (
              <SimpleGrid cols={2}>
                <Text size="sm">Scopes</Text>
                <ValueText>{formatScopes(oauth.scopes)}</ValueText>
              </SimpleGrid>
            )}
            {oauth.accessToken && (
              <OAuthTokenField
                label="Access Token"
                token={oauth.accessToken}
                onClear={onClearOAuth}
                clearLabel={CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL}
              />
            )}
            {/* Viewer only — an `id_token` the AS happened to return, decoded
                on request. It carries no clear action: clearing OAuth state is
                one action for the whole token set, owned by the access-token
                row (or the standalone button below when there is none). */}
            {oauth.idToken && (
              <OAuthTokenField label="ID Token" token={oauth.idToken} />
            )}
            {!oauth.accessToken && onClearOAuth && (
              <Flex justify="flex-end">
                <ClearOAuthButton onClick={onClearOAuth}>
                  {CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL}
                </ClearOAuthButton>
              </Flex>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
