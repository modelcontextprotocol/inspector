import { useEffect, useMemo, useState } from "react";
import {
  parseServerJson,
  buildServerConfigForSelection,
  isRuntimeControlEnvVar,
  selectServerJsonOption,
  type ParsedServerJson,
} from "@inspector/core/mcp/import/index.js";
import type {
  InspectorServerJsonDraft,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import type {
  EnvVarInfo,
  LaunchEnvEntry,
  LaunchPreview,
  PackageInfo,
  ValidationResult,
} from "../components/groups/ImportServerJsonPanel/ImportServerJsonPanel";
import { errorMessage } from "../utils/errorFormat";
import { formatCommandLine, quoteShellArg } from "../utils/commandLine";

/** Debounce (ms) before a textarea edit re-triggers parse/validation. */
export const VALIDATE_DEBOUNCE_MS = 300;

/**
 * Delay (ms) after content is loaded/pasted before the File Contents disclosure
 * auto-collapses — long enough to read as "the content was accepted".
 */
export const COLLAPSE_DELAY_MS = 1000;

/**
 * How long (ms) to flash the disclosure with its hover background just before it
 * collapses, so the collapse reads as intentional rather than abrupt.
 */
export const HIGHLIGHT_DURATION_MS = 250;

const EMPTY_DRAFT: InspectorServerJsonDraft = {
  rawText: "",
  envOverrides: {},
};

/** Result of parsing the current draft text. */
type ParseState =
  | { ok: true; parsed: ParsedServerJson }
  | { ok: false; error: string }
  | { ok: null };

/** Shown in place of a secret env var's value in the launch preview. */
export const SECRET_MASK = "********";

/**
 * Whether a declared variable's value is hidden. A variable that controls the
 * runtime is never hidden, even when declared `isSecret`: its value decides
 * what the command runs, so masking it would let a document hide exactly the
 * part of the launch the preview exists to show.
 */
function isMaskedSecret(name: string, secretNames: ReadonlySet<string>) {
  return secretNames.has(name) && !isRuntimeControlEnvVar(name);
}

function describeEnvEntry(
  name: string,
  value: string,
  secretNames: ReadonlySet<string>,
): LaunchEnvEntry {
  const masked = isMaskedSecret(name, secretNames);
  return {
    name,
    display: `${name}=${masked ? SECRET_MASK : quoteShellArg(value)}`,
    masked,
    runtimeControl: isRuntimeControlEnvVar(name),
  };
}

/**
 * Describe the config an import will save: the shell-quoted command line and
 * every env var it sets (`NAME=value`, secrets masked) for a stdio server, or
 * the URL for a remote. Built from the same `buildServerConfigForSelection`
 * output `submit` persists, so what the panel shows cannot drift from what gets
 * saved. `secretNames` are the variables the server.json declares `isSecret`.
 */
export function describeLaunch(
  config: MCPServerConfig,
  secretNames: ReadonlySet<string> = new Set(),
): LaunchPreview {
  if (config.type === "sse" || config.type === "streamable-http") {
    return { kind: "url", value: config.url, env: [] };
  }
  return {
    kind: "command",
    value: formatCommandLine(config.command, config.args),
    env: Object.entries(config.env ?? {}).map(([name, value]) =>
      describeEnvEntry(name, value, secretNames),
    ),
  };
}

/**
 * Identify the runtime-control variables a config sets, and their values, as a
 * comparable string — empty when it sets none. The user's confirmation is
 * recorded against this, so editing any flagged value (or switching to a
 * package that sets different ones) withdraws it rather than carrying a
 * confirmation over to values the user never confirmed.
 */
export function runtimeControlSignature(config: MCPServerConfig): string {
  if (config.type === "sse" || config.type === "streamable-http") return "";
  const flagged = Object.entries(config.env ?? {}).filter(([name]) =>
    isRuntimeControlEnvVar(name),
  );
  return flagged.length > 0 ? JSON.stringify(flagged) : "";
}

function parseDraft(rawText: string): ParseState {
  if (!rawText.trim()) return { ok: null };
  try {
    return { ok: true, parsed: parseServerJson(rawText) };
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
    };
  }
}

export interface UseServerJsonImportOptions {
  /** Whether the host modal is open — drives the per-open reset. */
  opened: boolean;
  /** Ids already in use — drives the duplicate-id warning. */
  existingIds: string[];
  /** Persist the chosen server. Resolves once the catalog has been updated. */
  onAddServer: (id: string, config: MCPServerConfig) => Promise<void> | void;
}

/** View-model the dumb `ImportServerJsonPanel` renders from. */
export interface ServerJsonImportViewModel {
  draft: InspectorServerJsonDraft;
  validation: ValidationResult[];
  packages?: PackageInfo[];
  envVars: EnvVarInfo[];
  /** What importing the selected option will save and run. */
  launchPreview?: LaunchPreview;
  /**
   * Whether the user has confirmed the runtime-control env vars the current
   * launch sets. Add stays disabled until they have, when there are any.
   */
  runtimeControlAcknowledged: boolean;
  canAdd: boolean;
  /** Derived id from the server.json `name` (before any override). */
  defaultServerName: string;
  fileContentsOpen: boolean;
  fileContentsHighlight: boolean;
  setRawText: (content: string) => void;
  selectPackage: (index: number) => void;
  setEnvVar: (name: string, value: string) => void;
  setServerName: (name: string) => void;
  setRuntimeControlAcknowledged: (acknowledged: boolean) => void;
  pickFile: (file: File | null) => Promise<void>;
  setFileContentsOpen: (open: boolean) => void;
  /** Build + persist the selected server. Resolves to true when it was added. */
  submit: () => Promise<boolean>;
}

/**
 * Wiring for the registry `server.json` import (#1348): owns the draft + parse
 * state, the debounced validation, and the File Contents auto-collapse, and
 * builds/persists the selected server on submit. Keeps `ServerImportJsonModal`
 * a thin display component; the reusable parsing/selection lives in
 * `core/mcp/import`.
 */
export function useServerJsonImport({
  opened,
  existingIds,
  onAddServer,
}: UseServerJsonImportOptions): ServerJsonImportViewModel {
  const [draft, setDraft] = useState<InspectorServerJsonDraft>(EMPTY_DRAFT);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  // Debounced copy of the raw text that drives parsing/validation, so typing
  // doesn't re-parse on every keystroke. The textarea stays bound to live text.
  const [debouncedText, setDebouncedText] = useState<string>(
    EMPTY_DRAFT.rawText,
  );
  // The File Contents disclosure starts open and auto-collapses shortly after
  // content is loaded/pasted; `highlight` flashes its hover bg before collapse.
  const [fileContentsOpen, setFileContentsOpen] = useState(true);
  const [fileContentsHighlight, setFileContentsHighlight] = useState(false);
  // The runtime-control signature the user confirmed, or null. Stored as the
  // signature rather than a boolean so a later edit invalidates it by itself.
  const [acknowledgedSignature, setAcknowledgedSignature] = useState<
    string | null
  >(null);

  // Reset each time the modal transitions to open. Done during render (React's
  // "adjust state when a prop changes" pattern) so there's no extra commit.
  const [prevOpened, setPrevOpened] = useState(opened);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setDraft(EMPTY_DRAFT);
      setSubmitError(undefined);
      setDebouncedText(EMPTY_DRAFT.rawText);
      setFileContentsOpen(true);
      setFileContentsHighlight(false);
      setAcknowledgedSignature(null);
    }
  }

  // Re-validate after the user pauses typing. setState lives in the timeout
  // callback (not the effect body), so this doesn't cascade-render.
  useEffect(() => {
    const id = setTimeout(
      () => setDebouncedText(draft.rawText),
      VALIDATE_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [draft.rawText]);

  // Once there's content, flash the disclosure's hover highlight and then
  // collapse it, signalling the paste/file load was accepted and surfacing the
  // validation / env-var sections. Clearing re-opens it (see setRawText).
  useEffect(() => {
    if (!draft.rawText.trim()) return;
    let collapseTimer: ReturnType<typeof setTimeout> | undefined;
    const highlightTimer = setTimeout(() => {
      setFileContentsHighlight(true);
      collapseTimer = setTimeout(() => {
        setFileContentsHighlight(false);
        setFileContentsOpen(false);
      }, HIGHLIGHT_DURATION_MS);
    }, COLLAPSE_DELAY_MS);
    return () => {
      clearTimeout(highlightTimer);
      if (collapseTimer) clearTimeout(collapseTimer);
    };
  }, [draft.rawText]);

  const parseState = useMemo(() => parseDraft(debouncedText), [debouncedText]);
  const selection = useMemo(() => {
    if (parseState.ok !== true) return undefined;
    return selectServerJsonOption(parseState.parsed, {
      selectedIndex: draft.selectedPackageIndex,
      idOverride: draft.nameOverride,
      existingIds,
    });
  }, [parseState, draft.selectedPackageIndex, draft.nameOverride, existingIds]);

  const selectedIndex = selection?.selectedIndex ?? 0;
  const selectedOption = selection?.selectedOption;
  const parsed = parseState.ok === true ? parseState.parsed : undefined;

  // Whether the preview reflects the textarea. The preview (and the launch it
  // shows) is built from the debounced text, so until the debounce settles an
  // edit has not been shown to the user and must not be submittable.
  const previewIsCurrent = draft.rawText === debouncedText;

  const selectedConfig = selectedOption
    ? buildServerConfigForSelection(selectedOption, draft.envOverrides)
    : undefined;
  const signature = selectedConfig
    ? runtimeControlSignature(selectedConfig)
    : "";
  const runtimeControlAcknowledged =
    signature !== "" && acknowledgedSignature === signature;

  // The Add button is enabled only when the (debounced) content validates and
  // matches what is in the textarea, and any runtime-control env vars it sets
  // have been confirmed.
  const canAdd =
    previewIsCurrent &&
    selection !== undefined &&
    selection.idIsValid &&
    !selection.idIsDuplicate &&
    (signature === "" || runtimeControlAcknowledged);

  const packages: PackageInfo[] | undefined = parsed?.options.map((o) => ({
    registryType: o.registryType,
    identifier: o.identifier,
    runtimeHint: o.runtimeHint,
  }));

  const secretNames = new Set(
    (selectedOption?.envVars ?? [])
      .filter((v) => v.isSecret)
      .map((v) => v.name),
  );

  const envVars: EnvVarInfo[] = (selectedOption?.envVars ?? []).map((v) => ({
    name: v.name,
    description: v.description,
    required: v.required,
    value: draft.envOverrides[v.name] ?? v.default ?? "",
    ...(isMaskedSecret(v.name, secretNames) ? { isSecret: true } : {}),
  }));

  const launchPreview = selectedConfig
    ? describeLaunch(selectedConfig, secretNames)
    : undefined;

  const validation: ValidationResult[] = useMemo(() => {
    if (parseState.ok === null) {
      return [
        { type: "info", message: "Paste server.json content to validate." },
      ];
    }
    if (parseState.ok === false) {
      return [{ type: "error", message: parseState.error }];
    }
    const results: ValidationResult[] = [
      {
        type: "success",
        message: `Valid server.json for "${parseState.parsed.fullName}".`,
      },
      {
        type: "info",
        message: `${parseState.parsed.options.length} runnable option(s) found.`,
      },
    ];
    if (selection && !selection.idIsValid) {
      results.push({
        type: "error",
        message:
          "Server id must use only letters, numbers, hyphens, underscores.",
      });
    } else if (selection?.idIsDuplicate) {
      results.push({
        type: "warning",
        message: `A server with id "${selection.serverId}" already exists.`,
      });
    }
    return results;
  }, [parseState, selection]);

  const allValidation = submitError
    ? [...validation, { type: "error" as const, message: submitError }]
    : validation;

  function setRawText(content: string) {
    setSubmitError(undefined);
    setDraft((d) => ({ ...d, rawText: content }));
    // A fresh edit cancels any in-flight pre-collapse highlight.
    setFileContentsHighlight(false);
    // Re-open the disclosure when the textarea is cleared so it's ready to paste
    // into again.
    if (!content.trim()) setFileContentsOpen(true);
  }

  function selectPackage(index: number) {
    setDraft((d) => ({ ...d, selectedPackageIndex: index }));
  }

  function setEnvVar(name: string, value: string) {
    setDraft((d) => ({
      ...d,
      envOverrides: { ...d.envOverrides, [name]: value },
    }));
  }

  function setServerName(name: string) {
    setDraft((d) => ({ ...d, nameOverride: name }));
  }

  function setRuntimeControlAcknowledged(acknowledged: boolean) {
    setSubmitError(undefined);
    setAcknowledgedSignature(acknowledged ? signature : null);
  }

  async function pickFile(file: File | null) {
    if (!file) return;
    setSubmitError(undefined);
    setFileContentsHighlight(false);
    try {
      const text = await file.text();
      setDraft((d) => ({ ...d, rawText: text }));
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  }

  async function submit(): Promise<boolean> {
    setSubmitError(undefined);
    // Refuse while an edit is still inside the debounce window: the preview
    // has not yet shown its launch, so saving it would persist a command the
    // user never saw. Add is disabled then too; this covers a click that
    // lands before the button re-renders.
    if (!previewIsCurrent) {
      setSubmitError("Wait for validation to finish before adding the server.");
      return false;
    }
    const live = parseDraft(draft.rawText);
    if (live.ok !== true) {
      setSubmitError("Fix the validation errors before adding the server.");
      return false;
    }
    const sel = selectServerJsonOption(live.parsed, {
      selectedIndex: draft.selectedPackageIndex,
      idOverride: draft.nameOverride,
      existingIds,
    });
    if (!sel.idIsValid || sel.idIsDuplicate) {
      setSubmitError("Fix the validation errors before adding the server.");
      return false;
    }
    const config = buildServerConfigForSelection(
      sel.selectedOption,
      draft.envOverrides,
    );
    // The confirmation must cover the values being saved, not merely some
    // values the user once confirmed. Add is disabled otherwise; this covers a
    // click that lands before the button re-renders.
    const liveSignature = runtimeControlSignature(config);
    if (liveSignature !== "" && liveSignature !== acknowledgedSignature) {
      setSubmitError(
        "Confirm the runtime-control environment variables before adding the server.",
      );
      return false;
    }
    try {
      await onAddServer(sel.serverId, config);
      return true;
    } catch (err) {
      setSubmitError(errorMessage(err));
      return false;
    }
  }

  return {
    draft: { ...draft, selectedPackageIndex: selectedIndex },
    validation: allValidation,
    packages,
    envVars,
    launchPreview,
    runtimeControlAcknowledged,
    canAdd,
    defaultServerName: parsed?.serverName ?? "",
    fileContentsOpen,
    fileContentsHighlight,
    setRawText,
    selectPackage,
    setEnvVar,
    setServerName,
    setRuntimeControlAcknowledged,
    pickFile,
    setFileContentsOpen,
    submit,
  };
}
