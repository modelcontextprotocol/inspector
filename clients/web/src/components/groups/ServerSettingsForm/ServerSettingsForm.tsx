import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Code,
  Flex,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import { JsonObjectInput } from "../../elements/JsonObjectInput/JsonObjectInput";
import type { ChangeEvent } from "react";
import type { ProtocolEra } from "@modelcontextprotocol/client";
import type {
  InspectorServerSettings,
  ModernLogLevel,
  OAuthSettings,
  RequestMetadata,
  ServerProtocolEra,
  ServerType,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_MODERN_LOG_LEVEL,
  DEFAULT_PROTOCOL_ERA,
  MODERN_LOG_LEVELS,
} from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerType } from "@inspector/core/mcp/config.js";
import {
  RESERVED_AUTHORIZATION_PARAMS,
  authorizationParamKeyError,
  isReservedAuthorizationParam,
} from "@inspector/core/auth/authorizationParams.js";
import { oauthEndpointUrlError } from "@inspector/core/auth/endpointOverrides.js";
import { ADVERTISABLE_EXTENSIONS } from "@inspector/core/mcp/extensions.js";
import type { Root } from "@modelcontextprotocol/client";

/**
 * Resolve the advertised state of an extension for the form: the per-server
 * override wins, else the registry default. Mirrors `buildClientExtensions`'s
 * resolution so the switches show exactly what the client will advertise.
 */
function isExtensionAdvertised(
  settings: InspectorServerSettings,
  key: string,
  defaultAdvertised: boolean,
): boolean {
  return settings.advertisedExtensions?.[key] ?? defaultAdvertised;
}

export type ServerSettingsSection =
  | "options"
  | "extensions"
  | "environment"
  | "headers"
  | "metadata"
  | "timeouts"
  | "oauth"
  | "roots";

export interface ServerSettingsFormProps {
  settings: InspectorServerSettings;
  /** Transport type — EMA checkbox is hidden for stdio. Defaults to streamable-http. */
  serverType?: ServerType;
  /**
   * Whether the target server uses the stdio transport. Gates the Working
   * Directory field and Environment Variables section in the Options area —
   * both are stdio-only config concepts and hidden for sse / streamable-http.
   */
  isStdio: boolean;
  expandedSections: ServerSettingsSection[];
  onExpandedSectionsChange: (sections: ServerSettingsSection[]) => void;
  onAddHeader: () => void;
  onRemoveHeader: (index: number) => void;
  onHeaderChange: (index: number, key: string, value: string) => void;
  onAddEnv: () => void;
  onRemoveEnv: (index: number) => void;
  onEnvChange: (index: number, key: string, value: string) => void;
  onCwdChange: (value: string) => void;
  /**
   * Replace the whole default-`_meta` payload. Not the `(index, key, value)`
   * row callback the header/env editors use — metadata is edited as a JSON
   * object, since a `_meta` value may be any JSON (#1910).
   */
  onMetadataChange: (metadata: RequestMetadata) => void;
  onTimeoutChange: (
    field: "connectionTimeout" | "requestTimeout" | "taskTtl",
    value: number,
  ) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onPaginatedListsChange: (value: boolean) => void;
  /**
   * Toggle whether the Inspector advertises the extension `key` to this server.
   * `checked` is the new advertise state; the modal folds it into
   * `settings.advertisedExtensions`. (#1739)
   */
  onAdvertisedExtensionChange: (key: string, checked: boolean) => void;
  onMaxFetchRequestsChange: (value: number) => void;
  onProtocolEraChange: (value: ServerProtocolEra) => void;
  onModernLogLevelChange: (value: ModernLogLevel) => void;
  /**
   * The era this server actually negotiated, when it is the live connection —
   * `undefined` when this server isn't the connected one. Used to hide the
   * modern-only "Log Level per Request" control once an `auto` server resolves
   * to legacy at connect time (#1629). A pinned `legacy` era hides it
   * regardless (no connection needed).
   */
  negotiatedEra?: ProtocolEra;
  onOAuthChange: (oauth: OAuthSettings) => void;
  onClearStoredOAuth?: () => void;
  onAddRoot: () => void;
  onRemoveRoot: (index: number) => void;
  onRootChange: (index: number, uri: string, name: string) => void;
}

// Protocol-era options (SEP §7.8). Values are `ServerProtocolEra`; the pinned
// modern revision is an internal detail (MODERN_PROTOCOL_VERSION), so the label
// stays version-free.
const PROTOCOL_ERA_OPTIONS: { value: ServerProtocolEra; label: string }[] = [
  { value: "legacy", label: "Legacy (2025-11-25 handshake)" },
  { value: "auto", label: "Auto (probe, fall back to legacy)" },
  { value: "modern", label: "Modern (2026-07-28, sessionless)" },
];

const PROTOCOL_ERA_VALUES: ReadonlySet<ServerProtocolEra> = new Set(
  PROTOCOL_ERA_OPTIONS.map((o) => o.value),
);

function isProtocolEra(value: string | null): value is ServerProtocolEra {
  return value !== null && PROTOCOL_ERA_VALUES.has(value as ServerProtocolEra);
}

// Modern per-request log-level options (#1629): "Off" plus the eight levels.
// Only meaningful on the modern era; labeled so the "Off" state reads clearly.
const MODERN_LOG_LEVEL_OPTIONS: { value: ModernLogLevel; label: string }[] =
  MODERN_LOG_LEVELS.map((level) => ({
    value: level,
    label: level === "off" ? "Off (no logs)" : level,
  }));

const MODERN_LOG_LEVEL_VALUES: ReadonlySet<ModernLogLevel> = new Set(
  MODERN_LOG_LEVELS,
);

function isModernLogLevelValue(value: string | null): value is ModernLogLevel {
  return value !== null && MODERN_LOG_LEVEL_VALUES.has(value as ModernLogLevel);
}

// `rightSectionPointerEvents="auto"` keeps the ClearButton clickable inside the
// input's right section; shared by every clearable field in this form.
const ClearableTextInput = TextInput.withProps({
  rightSectionPointerEvents: "auto",
});

const LogSizeInput = NumberInput.withProps({
  min: 0,
  step: 100,
});

const TimeoutInput = NumberInput.withProps({
  suffix: " ms",
});

const ExtensionsHint = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const ClearOAuthRow = Flex.withProps({
  align: "flex-start",
  gap: "sm",
  wrap: "wrap",
});

const RemoveIcon = ActionIcon.withProps({
  color: "red",
  variant: "subtle",
});

const AddButton = Button.withProps({
  size: "xs",
  variant: "light",
});

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const EmptyHint = Text.withProps({
  size: "sm",
  c: "dimmed",
  fs: "italic",
});

// Matches the label/description pair Mantine renders for a single input, so the
// authorization-parameter row list reads as one labelled field next to Scopes.
const FieldLabel = Text.withProps({
  size: "sm",
  fw: 500,
});

const FieldDescription = Text.withProps({
  size: "xs",
  c: "dimmed",
});

// `align="flex-start"` keeps the key/value/remove controls top-aligned when the
// key input grows an error message, so the row doesn't jump as it appears.
const AuthorizationParamRow = Group.withProps({
  grow: true,
  align: "flex-start",
});

const ClearStoredOAuthButton = Button.withProps({
  variant: "light",
  color: "red",
  size: "compact-sm",
  flex: "0 0 auto",
});

const ClearStoredOAuthHint = Text.withProps({
  size: "sm",
  c: "dimmed",
  flex: 1,
  miw: "12rem",
});

function KeyValueRows({
  items,
  entityLabel,
  onChange,
  onRemove,
}: {
  items: { key: string; value: string }[];
  /**
   * Singular noun for one row ("header", "environment variable", …). Used only
   * to build each control's `aria-label`: the section heading and the "Key" /
   * "Value" placeholders are not programmatically associated with the inputs,
   * so without it an assistive technology cannot tell one section's key box
   * from another's, and every remove button announces only "X". The row number
   * rides along because two rows can carry the same key — mid-edit, or a
   * duplicate a server persisted — and a key-only name would leave both rows'
   * controls indistinguishable, which is the thing this exists to prevent.
   */
  entityLabel: string;
  onChange: (index: number, key: string, value: string) => void;
  onRemove: (index: number) => void;
}) {
  /* v8 ignore next 3 -- unreachable: every caller guards with `length === 0`
     and renders an EmptyHint instead, so KeyValueRows is only mounted with
     a non-empty list. */
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map((item, index) => {
        const key = item.key.trim();
        const rowLabel = key ? `${key}, row ${index + 1}` : `row ${index + 1}`;
        return (
          <Group key={index} grow>
            <ClearableTextInput
              placeholder="Key"
              aria-label={`${entityLabel} name, ${rowLabel}`}
              value={item.key}
              onChange={(e) =>
                onChange(index, e.currentTarget.value, item.value)
              }
              rightSection={
                item.key ? (
                  <ClearButton
                    aria-label={`Clear ${entityLabel} name, ${rowLabel}`}
                    onClick={() => onChange(index, "", item.value)}
                  />
                ) : null
              }
            />
            <ClearableTextInput
              placeholder="Value"
              aria-label={`${entityLabel} value, ${rowLabel}`}
              value={item.value}
              onChange={(e) => onChange(index, item.key, e.currentTarget.value)}
              rightSection={
                item.value ? (
                  <ClearButton
                    aria-label={`Clear ${entityLabel} value, ${rowLabel}`}
                    onClick={() => onChange(index, item.key, "")}
                  />
                ) : null
              }
            />
            <RemoveIcon
              aria-label={`Remove ${entityLabel}, ${rowLabel}`}
              onClick={() => onRemove(index)}
            >
              X
            </RemoveIcon>
          </Group>
        );
      })}
    </>
  );
}

// Reserved-key rejection is inline per row (#2018): the reason is passed as the
// key input's `error` **string**, so Mantine renders it in the input's own error
// slot and wires the `aria-describedby` association — a bare boolean would mark
// the field invalid without telling a screen reader why. The section-level Alert
// below repeats it so the rejection stays visible when the offending row is
// scrolled out of view.
//
// Each control carries a per-row `aria-label`: the section heading and the
// placeholders are not programmatically associated with the inputs, so without
// one an assistive technology cannot tell the key box from the value box, and
// the remove button announces only "X".
function AuthorizationParamRows({
  params,
  onChange,
  onRemove,
}: {
  params: { key: string; value: string }[];
  onChange: (index: number, key: string, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <>
      {params.map((param, index) => {
        const rowLabel = param.key.trim() || `row ${index + 1}`;
        return (
          <AuthorizationParamRow key={index}>
            <ClearableTextInput
              aria-label={`Authorization parameter name, ${rowLabel}`}
              placeholder="Parameter (e.g. kc_idp_hint)"
              value={param.key}
              error={authorizationParamKeyError(param.key)}
              onChange={(e) =>
                onChange(index, e.currentTarget.value, param.value)
              }
              rightSection={
                param.key ? (
                  <ClearButton
                    onClick={() => onChange(index, "", param.value)}
                  />
                ) : null
              }
            />
            <ClearableTextInput
              aria-label={`Authorization parameter value, ${rowLabel}`}
              placeholder="Value"
              value={param.value}
              onChange={(e) =>
                onChange(index, param.key, e.currentTarget.value)
              }
              rightSection={
                param.value ? (
                  <ClearButton onClick={() => onChange(index, param.key, "")} />
                ) : null
              }
            />
            <RemoveIcon
              aria-label={`Remove authorization parameter ${rowLabel}`}
              onClick={() => onRemove(index)}
            >
              X
            </RemoveIcon>
          </AuthorizationParamRow>
        );
      })}
    </>
  );
}

function RootRows({
  roots,
  onChange,
  onRemove,
}: {
  roots: Root[];
  onChange: (index: number, uri: string, name: string) => void;
  onRemove: (index: number) => void;
}) {
  /* v8 ignore next 3 -- unreachable: the caller guards with `length === 0`
     and renders an EmptyHint instead, so RootRows is only mounted with a
     non-empty list. */
  if (roots.length === 0) {
    return null;
  }

  return (
    <>
      {roots.map((root, index) => (
        <Group key={index} grow>
          <ClearableTextInput
            placeholder="URI (e.g. file:///path)"
            value={root.uri}
            onChange={(e) =>
              onChange(index, e.currentTarget.value, root.name ?? "")
            }
            rightSection={
              root.uri ? (
                <ClearButton
                  onClick={() => onChange(index, "", root.name ?? "")}
                />
              ) : null
            }
          />
          <ClearableTextInput
            placeholder="Name (optional)"
            value={root.name ?? ""}
            onChange={(e) => onChange(index, root.uri, e.currentTarget.value)}
            rightSection={
              root.name ? (
                <ClearButton onClick={() => onChange(index, root.uri, "")} />
              ) : null
            }
          />
          <RemoveIcon onClick={() => onRemove(index)}>X</RemoveIcon>
        </Group>
      ))}
    </>
  );
}

export function ServerSettingsForm({
  settings,
  serverType = "streamable-http",
  isStdio,
  expandedSections,
  onExpandedSectionsChange,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onAddEnv,
  onRemoveEnv,
  onEnvChange,
  onCwdChange,
  onMetadataChange,
  onTimeoutChange,
  onAutoRefreshChange,
  onPaginatedListsChange,
  onAdvertisedExtensionChange,
  onMaxFetchRequestsChange,
  onProtocolEraChange,
  onModernLogLevelChange,
  negotiatedEra,
  onOAuthChange,
  onClearStoredOAuth,
  onAddRoot,
  onRemoveRoot,
  onRootChange,
}: ServerSettingsFormProps) {
  const oauthCapable = isOAuthCapableServerType(serverType);
  // Under enterprise-managed auth these fields hold the *resource authorization
  // server* credentials (leg 3 — its registered client), not the app/IdP pair
  // configured in Client Settings. The toggle's label mentions the IdP, which
  // pulls the reader toward the wrong pair — so qualify the labels and add a
  // description when EMA is on (#1692).
  const enterpriseManaged = settings.enterpriseManaged ?? false;
  const clientIdLabel = enterpriseManaged
    ? "Resource AS Client ID"
    : "Client ID";
  const clientSecretLabel = enterpriseManaged
    ? "Resource AS Client Secret"
    : "Client Secret";
  const resourceAsDescription = enterpriseManaged
    ? "The resource authorization server's registered client credential (EMA leg 3) — not the app client id/secret, which belong in Client Settings."
    : undefined;
  // The modern per-request "Log Level per Request" control is meaningless on a
  // legacy connection (#1629). Hide it when legacy is pinned, or when an `auto`
  // server negotiated legacy at connect time. A pinned `modern` server, and an
  // `auto` server that is either not yet connected or resolved to modern, keep
  // it visible.
  const configuredEra = settings.protocolEra ?? DEFAULT_PROTOCOL_ERA;
  const showModernLogLevel =
    configuredEra === "modern" ||
    (configuredEra === "auto" && negotiatedEra !== "legacy");
  const handleMaxFetchRequestsChange = (value: number | string) => {
    if (typeof value === "number") {
      onMaxFetchRequestsChange(value);
      return;
    }
    // Mantine emits "" when the field is cleared. Don't coerce that to 0 — 0
    // means "unlimited", and since the value applies live on modal close,
    // clearing-to-retype-then-closing would silently switch the log to
    // unlimited. Keep the current value on an empty/NaN parse; reserve 0 for an
    // explicit numeric entry.
    const parsed = parseInt(value, 10);
    onMaxFetchRequestsChange(
      Number.isNaN(parsed) ? settings.maxFetchRequests : parsed,
    );
  };
  const handleTimeoutChange =
    (field: "connectionTimeout" | "requestTimeout" | "taskTtl") =>
    (value: number | string) => {
      const numValue =
        typeof value === "string" ? parseInt(value, 10) || 0 : value;
      onTimeoutChange(field, numValue);
    };

  // #2018 — custom authorization-request parameters. The rows ride the single
  // `onOAuthChange` callback with the rest of the Authorization section rather
  // than growing three more props on this form.
  const authorizationParams = settings.oauthAuthorizationParams ?? [];

  function currentOAuth(): OAuthSettings {
    return {
      clientId: settings.oauthClientId ?? "",
      clientSecret: settings.oauthClientSecret ?? "",
      scopes: settings.oauthScopes ?? "",
      authorizationParams,
      authorizationUrl: settings.oauthAuthorizationUrl ?? "",
      tokenUrl: settings.oauthTokenUrl ?? "",
      enterpriseManaged: settings.enterpriseManaged ?? false,
      onInsufficientScope: settings.oauthOnInsufficientScope,
      // Unset means the default, on — only an explicit opt-out is stored.
      requestRefreshToken: settings.oauthRequestRefreshToken ?? true,
      // Unset means the default, on — only an explicit opt-out is stored.
      revokeOnClear: settings.oauthRevokeOnClear ?? true,
    };
  }

  // #1906 — the overrides are suppressed under EMA for the same reason the
  // custom authorization parameters are: that leg authorizes against the
  // enterprise IdP, a different authorization server.
  const endpointOverrideEmaNote = settings.enterpriseManaged
    ? " Not applied while Enterprise-managed authorization is on: that flow authorizes against the enterprise IdP, a different authorization server."
    : "";

  // #2068 — the opt-out only removes the SDK's *automatic* `offline_access`.
  // `prompt=consent` keys off the scope, not the grant, so an `offline_access`
  // the user typed here still forces the prompt the checkbox claims to avoid.
  // Flag that combination rather than letting it read as a fixed configuration.
  const scopesIncludeOfflineAccess = (settings.oauthScopes ?? "")
    .split(/\s+/)
    .includes("offline_access");
  const refreshTokenOptedOut = settings.oauthRequestRefreshToken === false;

  // #2068 — annotated under EMA. Not because the provider is bypassed (EMA
  // wraps a BaseOAuthClientProvider and forwards its `clientMetadata`), but
  // because the IdP authorization leg — the one the user signs in through —
  // uses a fixed `openid offline_access` scope this setting cannot change. The
  // control therefore cannot affect EMA's consent behavior, which is the whole
  // reason to touch it. Say so rather than leave it looking effective, matching
  // how the endpoint overrides annotate themselves.
  const refreshTokenEmaNote = settings.enterpriseManaged
    ? " Not applied while Enterprise-managed authorization is on: that flow signs in against the enterprise IdP using its own fixed scope, which this setting cannot change."
    : "";

  const rejectedParamKeys = authorizationParams
    .map((p) => p.key.trim())
    .filter((key) => isReservedAuthorizationParam(key));

  function changeAuthorizationParams(
    params: { key: string; value: string }[],
  ): void {
    onOAuthChange({ ...currentOAuth(), authorizationParams: params });
  }

  function handleRequestRefreshTokenChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    onOAuthChange({
      ...currentOAuth(),
      requestRefreshToken: event.currentTarget.checked,
    });
  }

  function handleRevokeOnClearChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    onOAuthChange({
      ...currentOAuth(),
      revokeOnClear: event.currentTarget.checked,
    });
  }

  function handleAddAuthorizationParam(): void {
    changeAuthorizationParams([...authorizationParams, { key: "", value: "" }]);
  }

  function handleRemoveAuthorizationParam(index: number): void {
    changeAuthorizationParams(
      authorizationParams.filter((_, i) => i !== index),
    );
  }

  function handleAuthorizationParamChange(
    index: number,
    key: string,
    value: string,
  ): void {
    changeAuthorizationParams(
      authorizationParams.map((p, i) => (i === index ? { key, value } : p)),
    );
  }

  return (
    // Stays inline: Accordion is a compound, `multiple`-discriminated generic,
    // so `.withProps({ multiple: true, ... })` loses its JSX call signature
    // (same tooling limit as Box).
    <Accordion
      multiple
      variant="separated"
      value={expandedSections}
      onChange={(value) =>
        onExpandedSectionsChange(value as ServerSettingsSection[])
      }
    >
      <Accordion.Item value="options">
        <Accordion.Control>Options</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Select
              label="Protocol Era"
              description="Which MCP protocol era to negotiate with this server (independent of the transport). Legacy uses the 2025-11-25 initialize handshake; Auto probes server/discover and falls back to legacy; Modern pins the 2026-07-28 sessionless protocol. Defaults to Legacy — debugging tools should not auto-probe."
              data={PROTOCOL_ERA_OPTIONS}
              value={settings.protocolEra ?? DEFAULT_PROTOCOL_ERA}
              onChange={(value) => {
                // Select emits `string | null`; the null (cleared) case is
                // unreachable here — the field is not clearable and the value
                // always resolves to a known era.
                /* v8 ignore next -- Select never emits an out-of-range value */
                if (isProtocolEra(value)) onProtocolEraChange(value);
              }}
              allowDeselect={false}
            />
            {showModernLogLevel && (
              <Select
                label="Log Level per Request"
                description="Modern-era only. On 2026-07-28 servers there is no logging/setLevel — the client opts into logs per request by stamping this level in each request's _meta, and logs arrive on the originating request's stream. Off requests no logs. Defaults to Debug so a modern connection surfaces server logs out of the box. Legacy servers ignore this and use Set Active Level."
                data={MODERN_LOG_LEVEL_OPTIONS}
                value={settings.modernLogLevel ?? DEFAULT_MODERN_LOG_LEVEL}
                onChange={(value) => {
                  // Select emits `string | null`; not clearable, so the value
                  // always resolves to a known option.
                  /* v8 ignore next -- Select never emits an out-of-range value */
                  if (isModernLogLevelValue(value))
                    onModernLogLevelChange(value);
                }}
                allowDeselect={false}
              />
            )}
            <Checkbox
              label="Auto Refresh on List Changed Notifications"
              description="When checked, tool/prompt/resource lists refresh automatically when the server sends a */list_changed notification. When unchecked, the list-changed indicator appears and you refresh on demand."
              checked={settings.autoRefreshOnListChanged ?? false}
              onChange={(e) => onAutoRefreshChange(e.currentTarget.checked)}
            />
            <Checkbox
              label="Fetch Lists One Page at a Time"
              description="When checked, the Tools, Resources, and Prompts lists load a single page and reveal a “Load next page” control instead of auto-loading every page. Useful defensively for servers with very large lists. The per-list sidebar toggle sets this too."
              checked={settings.paginatedLists ?? false}
              onChange={(e) => onPaginatedListsChange(e.currentTarget.checked)}
            />
            <LogSizeInput
              label="Network Log Size"
              description="Maximum number of HTTP requests kept in the Network log for this server. Older entries rotate out past this limit; a response body that arrives after its entry rotated out is dropped. Use 0 for unlimited (not recommended). Applies immediately to the active connection."
              value={settings.maxFetchRequests}
              onChange={handleMaxFetchRequestsChange}
            />
            {isStdio ? (
              <ClearableTextInput
                label="Working Directory"
                description="Directory the stdio server process is launched in. Leave empty to inherit the Inspector's working directory."
                placeholder="(inherit)"
                value={settings.cwd ?? ""}
                onChange={(e) => onCwdChange(e.currentTarget.value)}
                rightSection={
                  settings.cwd ? (
                    <ClearButton onClick={() => onCwdChange("")} />
                  ) : null
                }
              />
            ) : null}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="extensions">
        <Accordion.Control>Advertised Extensions</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            <ExtensionsHint>
              Which extensions the Inspector declares to this server in its
              client capabilities. A server may register different tools
              depending on what the client advertises — toggle these to debug
              that. Takes effect on the next connect.
            </ExtensionsHint>
            {ADVERTISABLE_EXTENSIONS.map((ext) => (
              <Checkbox
                key={ext.key}
                label={ext.label}
                checked={isExtensionAdvertised(
                  settings,
                  ext.key,
                  ext.defaultAdvertised,
                )}
                onChange={(e) =>
                  onAdvertisedExtensionChange(ext.key, e.currentTarget.checked)
                }
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      {isStdio ? (
        <Accordion.Item value="environment">
          <Accordion.Control>Environment Variables</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Group justify="space-between">
                <HintText>
                  Environment variables passed to the stdio server process.
                </HintText>
                <AddButton onClick={onAddEnv}>
                  + Add Environment Variable
                </AddButton>
              </Group>
              {settings.env.length === 0 ? (
                <EmptyHint>No environment variables configured</EmptyHint>
              ) : (
                <KeyValueRows
                  items={settings.env}
                  entityLabel="environment variable"
                  onChange={onEnvChange}
                  onRemove={onRemoveEnv}
                />
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      <Accordion.Item value="headers">
        <Accordion.Control>Custom Headers</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Headers sent with every HTTP request to this server. A custom
                `Authorization` header takes precedence over an OAuth access
                token — the SDK transports apply these headers last — so remove
                it once OAuth is configured, or the flow's token never gets
                sent.
              </HintText>
              <AddButton onClick={onAddHeader}>+ Add Header</AddButton>
            </Group>
            {settings.headers.length === 0 ? (
              <EmptyHint>No custom headers configured</EmptyHint>
            ) : (
              <KeyValueRows
                items={settings.headers}
                entityLabel="header"
                onChange={onHeaderChange}
                onRemove={onRemoveHeader}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="metadata">
        <Accordion.Control>Request Metadata</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <HintText>
              Metadata merged into the <Code>_meta</Code> field of every MCP
              request to this server, as a JSON object. Values may be any JSON —
              objects, arrays, numbers, booleans, <Code>null</Code> — not just
              strings. Leave it as <Code>{"{}"}</Code> to send none. The keys
              the protocol reserves keep their own shape:{" "}
              <Code>progressToken</Code> must be a string or a safe integer (one
              JavaScript can represent exactly), and{" "}
              <Code>io.modelcontextprotocol/related-task</Code> an object with a
              string <Code>taskId</Code>. A reserved key that does not match is
              dropped from the request rather than sent.
            </HintText>
            <JsonObjectInput
              ariaLabel="Request metadata JSON"
              value={settings.metadata}
              onChange={onMetadataChange}
            />
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="timeouts">
        <Accordion.Control>Timeouts</Accordion.Control>
        <Accordion.Panel>
          <Group>
            <TimeoutInput
              label="Connection Timeout"
              value={settings.connectionTimeout}
              onChange={handleTimeoutChange("connectionTimeout")}
            />
            <TimeoutInput
              label="Request Timeout"
              value={settings.requestTimeout}
              onChange={handleTimeoutChange("requestTimeout")}
            />
            <TimeoutInput
              label="Task TTL"
              min={1}
              value={settings.taskTtl}
              onChange={handleTimeoutChange("taskTtl")}
            />
          </Group>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="roots">
        <Accordion.Control>Roots</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Configure the root directories that the server can access. Each
                root needs a URI; the name is optional.
              </HintText>
              <AddButton onClick={onAddRoot}>+ Add Root</AddButton>
            </Group>
            {settings.roots.length === 0 ? (
              <EmptyHint>No roots configured</EmptyHint>
            ) : (
              <RootRows
                roots={settings.roots}
                onChange={onRootChange}
                onRemove={onRemoveRoot}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      {oauthCapable ? (
        <Accordion.Item value="oauth">
          <Accordion.Control>OAuth Settings</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Checkbox
                label="Enterprise-managed authorization"
                description="Connect via the configured enterprise IdP instead of interactive OAuth to the MCP authorization server. OAuth fields below are resource authorization server credentials."
                checked={enterpriseManaged}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    enterpriseManaged: e.currentTarget.checked,
                  })
                }
              />
              <HintText>
                Pre-configure OAuth credentials for servers requiring
                authentication
              </HintText>
              <ClearableTextInput
                label={clientIdLabel}
                description={resourceAsDescription}
                value={settings.oauthClientId ?? ""}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    clientId: e.currentTarget.value,
                  })
                }
                rightSection={
                  settings.oauthClientId ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), clientId: "" })
                      }
                    />
                  ) : null
                }
              />
              <ClearableTextInput
                label={clientSecretLabel}
                description={resourceAsDescription}
                value={settings.oauthClientSecret ?? ""}
                type="password"
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    clientSecret: e.currentTarget.value,
                  })
                }
                rightSection={
                  settings.oauthClientSecret ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), clientSecret: "" })
                      }
                    />
                  ) : null
                }
              />
              <ClearableTextInput
                label="Scopes"
                description="Space-separated OAuth scopes (RFC 6749). Do not use commas — a comma-separated entry is sent as one invalid token and rejected by the authorization server."
                placeholder="mcp tools:read env:read"
                value={settings.oauthScopes ?? ""}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    scopes: e.currentTarget.value,
                  })
                }
                rightSection={
                  settings.oauthScopes ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), scopes: "" })
                      }
                    />
                  ) : null
                }
              />
              <Checkbox
                label="Request refresh token"
                description={`Declares the refresh_token grant, so the authorization server may issue a refresh token and renew access tokens without a new sign-in. Uncheck it for authorization servers that reject the offline_access scope and forced consent prompt the grant brings with it. Applies on the next connect.${refreshTokenEmaNote}`}
                checked={settings.oauthRequestRefreshToken ?? true}
                onChange={handleRequestRefreshTokenChange}
              />
              <Checkbox
                label="Revoke tokens on clear"
                description="Calls the authorization server's RFC 7009 revocation endpoint when the stored OAuth state is cleared, so the grant ends when the session does instead of staying valid until it expires. Servers that advertise no revocation_endpoint are unaffected. Uncheck it to reproduce a client that disconnects still holding live tokens."
                checked={settings.oauthRevokeOnClear ?? true}
                onChange={handleRevokeOnClearChange}
              />
              {refreshTokenOptedOut && scopesIncludeOfflineAccess ? (
                <Alert color="yellow" title="offline_access is still requested">
                  The Scopes field above lists offline_access, and
                  prompt=consent is added whenever that scope is requested —
                  regardless of this setting. Remove it from Scopes as well, or
                  the consent prompt this checkbox is meant to avoid still goes
                  out.
                </Alert>
              ) : null}
              <Stack gap="xs">
                <FieldLabel>Additional authorization parameters</FieldLabel>
                <FieldDescription>
                  Extra query parameters appended to the authorization request
                  only — never the token request. Use them for provider-specific
                  hints such as kc_idp_hint, login_hint, prompt, acr_values, or
                  audience.
                  {settings.enterpriseManaged
                    ? " Not sent while Enterprise-managed authorization is on: that flow authorizes against the enterprise IdP, a different authorization server."
                    : ""}
                </FieldDescription>
                {authorizationParams.length === 0 ? (
                  <EmptyHint>No additional parameters configured</EmptyHint>
                ) : (
                  <AuthorizationParamRows
                    params={authorizationParams}
                    onChange={handleAuthorizationParamChange}
                    onRemove={handleRemoveAuthorizationParam}
                  />
                )}
                {rejectedParamKeys.length > 0 ? (
                  <Alert color="red" title="Reserved parameters ignored">
                    {`${rejectedParamKeys.join(", ")} ${
                      rejectedParamKeys.length === 1 ? "is" : "are"
                    } set by the authorization flow and will not be sent. Overriding ${
                      rejectedParamKeys.length === 1 ? "it" : "them"
                    } would break PKCE, the CSRF state binding, or the resource indicator. Reserved: ${RESERVED_AUTHORIZATION_PARAMS.join(
                      ", ",
                    )}.`}
                  </Alert>
                ) : null}
                <AddButton onClick={handleAddAuthorizationParam}>
                  + Add Parameter
                </AddButton>
              </Stack>
              <ClearableTextInput
                label="Authorization URL override"
                description={`Leave blank to use the authorization_endpoint the authorization server's metadata advertises. Set it to point this server at a development or staging authorization server instead. Endpoints only — the discovered issuer is unchanged, so an authorization server advertising a different issuer is rejected on callback (RFC 9207).${endpointOverrideEmaNote}`}
                placeholder="https://staging.auth.example.com/authorize"
                value={settings.oauthAuthorizationUrl ?? ""}
                error={oauthEndpointUrlError(
                  settings.oauthAuthorizationUrl ?? "",
                )}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    authorizationUrl: e.currentTarget.value,
                  })
                }
                rightSection={
                  settings.oauthAuthorizationUrl ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({
                          ...currentOAuth(),
                          authorizationUrl: "",
                        })
                      }
                    />
                  ) : null
                }
              />
              <ClearableTextInput
                label="Token URL override"
                description={`Leave blank to use the token_endpoint the authorization server's metadata advertises. Independent of the authorization URL — either can be overridden alone.${endpointOverrideEmaNote}`}
                placeholder="https://staging.auth.example.com/token"
                value={settings.oauthTokenUrl ?? ""}
                error={oauthEndpointUrlError(settings.oauthTokenUrl ?? "")}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    tokenUrl: e.currentTarget.value,
                  })
                }
                rightSection={
                  settings.oauthTokenUrl ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), tokenUrl: "" })
                      }
                    />
                  ) : null
                }
              />
              <Select
                label="Insufficient-scope response"
                description="On a 403 insufficient_scope challenge (SEP-2350): re-authorize with the accumulated scope union, or surface the error to you."
                data={[
                  {
                    value: "reauthorize",
                    label: "Re-authorize (union scopes)",
                  },
                  { value: "throw", label: "Throw (surface the error)" },
                ]}
                value={settings.oauthOnInsufficientScope ?? "reauthorize"}
                onChange={(value) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    onInsufficientScope:
                      value === "throw" ? "throw" : "reauthorize",
                  })
                }
                allowDeselect={false}
              />
              {onClearStoredOAuth ? (
                <ClearOAuthRow>
                  <ClearStoredOAuthButton onClick={onClearStoredOAuth}>
                    Clear stored OAuth state
                  </ClearStoredOAuthButton>
                  <ClearStoredOAuthHint>
                    Removes stored tokens and client registration for this
                    server. Disconnects if this server is currently connected.
                  </ClearStoredOAuthHint>
                </ClearOAuthRow>
              ) : null}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}
    </Accordion>
  );
}
