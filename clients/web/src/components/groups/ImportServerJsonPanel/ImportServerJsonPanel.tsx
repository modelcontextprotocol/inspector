import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Divider,
  FileButton,
  Group,
  PasswordInput,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import { JsonEditor } from "../../elements/JsonEditor/JsonEditor";
import type { InspectorServerJsonDraft } from "@inspector/core/mcp/types.js";

export interface ValidationResult {
  type: "success" | "warning" | "info" | "error";
  message: string;
}

export interface PackageInfo {
  registryType: string;
  identifier: string;
  runtimeHint: string;
}

/**
 * Exactly what importing the selected option will save and run, shown before
 * the user commits. A server.json's `runtimeArguments` are spliced in ahead of
 * the package reference, so the package label alone does not describe the
 * spawned process — this does.
 */
export interface LaunchPreview {
  /** `command` for a stdio package, `url` for a remote. */
  kind: "command" | "url";
  /** The full, shell-quoted command line (stdio) or the remote URL. */
  value: string;
  /** Every env var the saved config sets, in the order it sets them. */
  env: LaunchEnvEntry[];
}

/** One environment variable the launch sets, as the preview shows it. */
export interface LaunchEnvEntry {
  name: string;
  /** `NAME=value` with the value shell-quoted, or masked when `masked`. */
  display: string;
  /** The value is a declared secret and is hidden in `display`. */
  masked: boolean;
  /**
   * The variable changes which code the command loads or where it fetches
   * packages from, so the command line alone does not say what will run.
   */
  runtimeControl: boolean;
}

export interface EnvVarInfo {
  name: string;
  description?: string;
  required: boolean;
  value: string;
  /** Declared secret: the field hides its value. */
  isSecret?: boolean;
}

export interface ImportServerJsonPanelProps {
  draft: InspectorServerJsonDraft;
  validation: ValidationResult[];
  packages?: PackageInfo[];
  envVars: EnvVarInfo[];
  /** The resolved launch of the selected option; shown whenever present. */
  launchPreview?: LaunchPreview;
  /**
   * Whether the user has confirmed the launch's runtime-control env vars.
   * Only read when the preview flags at least one.
   */
  runtimeControlAcknowledged?: boolean;
  onRuntimeControlAcknowledgedChange?: (acknowledged: boolean) => void;
  onJsonChange: (content: string) => void;
  onSelectPackage: (index: number) => void;
  onEnvVarChange: (name: string, value: string) => void;
  onServerNameChange: (name: string) => void;
  /** The id derived from the server.json `name`, shown read-only in the
   *  Server Name disclosure (the override field replaces it when set). */
  defaultServerName?: string;
  onAddServer: () => void;
  /** Disables the Add Server button while the pasted content isn't valid. */
  addDisabled?: boolean;
  /**
   * Controls the "File Contents" disclosure. When `onFileContentsChange` is
   * provided the disclosure is controlled (the wiring layer can auto-collapse
   * it after content loads); otherwise it's uncontrolled and defaults to open.
   */
  fileContentsOpen?: boolean;
  onFileContentsChange?: (open: boolean) => void;
  /**
   * When true, the "File Contents" control is painted with its hover
   * background — used as a brief pre-collapse flash so the auto-collapse reads
   * intentionally.
   */
  fileContentsHighlight?: boolean;
  /**
   * Load server.json content from a file. When provided, a "Choose file…"
   * button is rendered next to the paste hint; the handler reads the file and
   * feeds its text back through `onJsonChange`.
   */
  onPickFile?: (file: File | null) => void;
}

const validationIcons: Record<
  ValidationResult["type"],
  { icon: string; color: string }
> = {
  success: { icon: "\u2713", color: "green" },
  warning: { icon: "\u26A0", color: "yellow" },
  info: { icon: "\u2139", color: "blue" },
  error: { icon: "\u2717", color: "red" },
};

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  align: "center",
  wrap: "nowrap",
});

// The header's trailing controls. `nowrap` keeps Clear beside Choose file…
// rather than wrapping one under the other in a narrow modal.
const HeaderActions = Group.withProps({ gap: "xs", wrap: "nowrap" });

const ChooseFileButton = Button.withProps({
  variant: "default",
  size: "xs",
});

// Clears the pasted document. It sits in the header row rather than inside the
// editor: Ace renders its own DOM and has no `rightSection` to hang a control
// in, and an absolutely-positioned button over a scrolling editor would sit on
// top of the text it is meant to help with.
const ClearContentsButton = Button.withProps({
  variant: "subtle",
  size: "xs",
  color: "gray",
});

const DefaultNameInput = TextInput.withProps({
  label: "From configuration",
  description: "The id derived from the server.json name.",
  readOnly: true,
});

const OverrideNameInput = TextInput.withProps({
  label: "Override",
  description: "Optional. Used instead of the name above.",
  rightSectionPointerEvents: "auto",
});

const LaunchCode = Code.withProps({
  block: true,
  variant: "wrapping",
});

const LaunchEnvList = Stack.withProps({ gap: "xs" });

const LaunchEnvRow = Group.withProps({
  gap: "xs",
  align: "center",
  wrap: "nowrap",
});

const LaunchEnvCode = Code.withProps({
  block: true,
  variant: "wrapping",
  flex: 1,
  miw: 0,
});

// The `status` variant pins amber hues to an AA-contrast fill in both schemes;
// a plain `light` orange chip does not clear 4.5:1.
const RuntimeControlBadge = Badge.withProps({
  color: "orange",
  variant: "status",
});

const SecretBadge = Badge.withProps({
  color: "gray",
  variant: "light",
});

const RuntimeControlAlert = Alert.withProps({
  variant: "warning",
  title: "These variables change what runs",
});

const AlertBody = Stack.withProps({ gap: "sm" });

const AlertText = Text.withProps({ size: "sm" });

function formatLaunchTitle(preview: LaunchPreview): string {
  return preview.kind === "command" ? "Command to Run:" : "Remote URL:";
}

function formatRuntimeControlWarning(entries: LaunchEnvEntry[]): string {
  const names = entries.map((entry) => entry.name).join(", ");
  return (
    `${names} ${entries.length === 1 ? "controls" : "control"} the runtime ` +
    "rather than the server: they can change which code the command loads, " +
    "or where it downloads the package from, so the command line above does " +
    "not by itself say what will run. Add this server only if you trust where " +
    "this server.json came from and expect these values."
  );
}

interface LaunchEnvProps {
  env: LaunchEnvEntry[];
}

/** The env vars the launch sets, one `NAME=value` row each, flags beside. */
function LaunchEnv({ env }: LaunchEnvProps) {
  return (
    <LaunchEnvList role="group" aria-label="Resolved environment">
      <HintText>Environment variables set:</HintText>
      {env.map((entry) => (
        <LaunchEnvRow key={entry.name}>
          <LaunchEnvCode>{entry.display}</LaunchEnvCode>
          {entry.runtimeControl && (
            <RuntimeControlBadge>Runtime control</RuntimeControlBadge>
          )}
          {entry.masked && <SecretBadge>Secret</SecretBadge>}
        </LaunchEnvRow>
      ))}
    </LaunchEnvList>
  );
}

interface RuntimeControlWarningProps {
  flagged: LaunchEnvEntry[];
  acknowledged: boolean;
  onAcknowledgedChange?: (acknowledged: boolean) => void;
}

/** Explains the flagged variables and takes the confirmation Add waits on. */
function RuntimeControlWarning({
  flagged,
  acknowledged,
  onAcknowledgedChange,
}: RuntimeControlWarningProps) {
  return (
    <RuntimeControlAlert>
      <AlertBody>
        <AlertText>{formatRuntimeControlWarning(flagged)}</AlertText>
        <Checkbox
          label="I have reviewed these values and want to run the command with them"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange?.(e.currentTarget.checked)}
        />
      </AlertBody>
    </RuntimeControlAlert>
  );
}

interface EnvVarFieldProps {
  envVar: EnvVarInfo;
  onEnvVarChange: (name: string, value: string) => void;
}

/**
 * One editable env var. A declared secret gets a `PasswordInput`, whose
 * visibility toggle occupies the right section the clear button uses
 * elsewhere, so it has no clear button.
 */
function EnvVarField({ envVar, onEnvVarChange }: EnvVarFieldProps) {
  if (envVar.isSecret) {
    return (
      <PasswordInput
        label={envVar.name}
        description={envVar.description}
        withAsterisk={envVar.required}
        value={envVar.value}
        onChange={(e) => onEnvVarChange(envVar.name, e.currentTarget.value)}
      />
    );
  }
  return (
    <TextInput
      label={envVar.name}
      description={envVar.description}
      withAsterisk={envVar.required}
      value={envVar.value}
      onChange={(e) => onEnvVarChange(envVar.name, e.currentTarget.value)}
      rightSectionPointerEvents="auto"
      rightSection={
        envVar.value ? (
          <ClearButton onClick={() => onEnvVarChange(envVar.name, "")} />
        ) : null
      }
    />
  );
}

function formatPackageLabel(pkg: PackageInfo): string {
  return `${pkg.registryType}: ${pkg.identifier} (${pkg.runtimeHint})`;
}

export function ImportServerJsonPanel({
  draft,
  validation,
  packages,
  envVars,
  launchPreview,
  runtimeControlAcknowledged,
  onRuntimeControlAcknowledgedChange,
  onJsonChange,
  onSelectPackage,
  onEnvVarChange,
  onServerNameChange,
  defaultServerName,
  onAddServer,
  addDisabled,
  fileContentsOpen,
  onFileContentsChange,
  fileContentsHighlight,
  onPickFile,
}: ImportServerJsonPanelProps) {
  // Validation results + the name-override field only make sense once there's
  // something to validate, so they stay hidden until content is pasted/loaded.
  const hasContent = draft.rawText.trim().length > 0;
  const flaggedEnv =
    launchPreview?.env.filter((entry) => entry.runtimeControl) ?? [];
  return (
    <Stack gap="md">
      <HeaderRow>
        <HintText>Paste server.json content, or load it from a file:</HintText>
        <HeaderActions>
          {hasContent && (
            <ClearContentsButton onClick={() => onJsonChange("")}>
              Clear
            </ClearContentsButton>
          )}
          {onPickFile ? (
            <FileButton accept="application/json,.json" onChange={onPickFile}>
              {(props) => (
                <ChooseFileButton {...props}>Choose file…</ChooseFileButton>
              )}
            </FileButton>
          ) : null}
        </HeaderActions>
      </HeaderRow>

      {/* Accordions here stay inline: Accordion is a compound,
          `multiple`-discriminated generic, so `.withProps()` loses its JSX call
          signature (same tooling limit as Box). */}
      <Accordion
        variant="separated"
        transitionDuration={325}
        {...(onFileContentsChange
          ? {
              value: fileContentsOpen ? "file-contents" : null,
              onChange: (value: string | null) =>
                onFileContentsChange(value === "file-contents"),
            }
          : { defaultValue: "file-contents" })}
      >
        <Accordion.Item value="file-contents">
          <Accordion.Control
            bg={
              fileContentsHighlight
                ? "var(--mantine-color-default-hover)"
                : undefined
            }
          >
            File Contents
          </Accordion.Control>
          <Accordion.Panel>
            <JsonEditor
              ariaLabel="File Contents"
              value={draft.rawText}
              onChange={onJsonChange}
              minLines={8}
              maxLines={20}
            />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {hasContent && (
        <>
          <Accordion variant="separated" defaultValue="validation">
            <Accordion.Item value="validation">
              <Accordion.Control>Validation Results</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {validation.map((result, index) => {
                    const { icon, color } = validationIcons[result.type];
                    return (
                      <Group key={index} gap="xs">
                        <Text c={color}>{icon}</Text>
                        <Text size="sm">{result.message}</Text>
                      </Group>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          {packages && packages.length > 1 && (
            <>
              <Divider />
              <Title order={5}>Package Selection:</Title>
              <Radio.Group
                value={String(draft.selectedPackageIndex ?? 0)}
                onChange={(value) => onSelectPackage(Number(value))}
              >
                <Stack gap="xs">
                  {packages.map((pkg, index) => (
                    <Radio
                      key={index}
                      value={String(index)}
                      label={formatPackageLabel(pkg)}
                    />
                  ))}
                </Stack>
              </Radio.Group>
            </>
          )}

          {launchPreview && (
            <>
              <Divider />
              <Title order={5}>{formatLaunchTitle(launchPreview)}</Title>
              <HintText>
                Review this before adding: the command and environment below are
                exactly what will be saved and run.
              </HintText>
              <LaunchCode aria-label="Resolved launch">
                {launchPreview.value}
              </LaunchCode>
              {launchPreview.env.length > 0 && (
                <LaunchEnv env={launchPreview.env} />
              )}
              {flaggedEnv.length > 0 && (
                <RuntimeControlWarning
                  flagged={flaggedEnv}
                  acknowledged={runtimeControlAcknowledged ?? false}
                  onAcknowledgedChange={onRuntimeControlAcknowledgedChange}
                />
              )}
            </>
          )}

          {envVars.length > 0 && (
            <>
              <Divider />
              <Title order={5}>Environment Variables:</Title>
              {envVars.map((envVar) => (
                <EnvVarField
                  key={envVar.name}
                  envVar={envVar}
                  onEnvVarChange={onEnvVarChange}
                />
              ))}
            </>
          )}

          <Accordion variant="separated" defaultValue="server-name">
            <Accordion.Item value="server-name">
              <Accordion.Control>Server Name</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <DefaultNameInput value={defaultServerName ?? ""} />
                  <OverrideNameInput
                    value={draft.nameOverride ?? ""}
                    onChange={(e) => onServerNameChange(e.currentTarget.value)}
                    rightSection={
                      draft.nameOverride ? (
                        <ClearButton onClick={() => onServerNameChange("")} />
                      ) : null
                    }
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}

      <Group justify="flex-end">
        <Button onClick={onAddServer} disabled={addDisabled}>
          Add Server
        </Button>
      </Group>
    </Stack>
  );
}
