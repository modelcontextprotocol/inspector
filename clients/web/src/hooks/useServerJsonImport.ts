import { useEffect, useMemo, useState } from "react";
import {
  parseServerJson,
  buildServerConfigForSelection,
  selectServerJsonOption,
  type ParsedServerJson,
} from "@inspector/core/mcp/import/index.js";
import type {
  InspectorServerJsonDraft,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import type {
  EnvVarInfo,
  PackageInfo,
  ValidationResult,
} from "../components/groups/ImportServerJsonPanel/ImportServerJsonPanel";

/** Debounce (ms) before a textarea edit re-triggers parse/validation. */
const VALIDATE_DEBOUNCE_MS = 300;

/**
 * Delay (ms) after content is loaded/pasted before the File Contents disclosure
 * auto-collapses — long enough to read as "the content was accepted".
 */
const COLLAPSE_DELAY_MS = 1000;

/**
 * How long (ms) to flash the disclosure with its hover background just before it
 * collapses, so the collapse reads as intentional rather than abrupt.
 */
const HIGHLIGHT_DURATION_MS = 250;

const EMPTY_DRAFT: InspectorServerJsonDraft = {
  rawText: "",
  envOverrides: {},
};

/** Result of parsing the current draft text. */
type ParseState =
  | { ok: true; parsed: ParsedServerJson }
  | { ok: false; error: string }
  | { ok: null };

function parseDraft(rawText: string): ParseState {
  if (!rawText.trim()) return { ok: null };
  try {
    return { ok: true, parsed: parseServerJson(rawText) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
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
  canAdd: boolean;
  /** Derived id from the server.json `name` (before any override). */
  defaultServerName: string;
  fileContentsOpen: boolean;
  fileContentsHighlight: boolean;
  setRawText: (content: string) => void;
  selectPackage: (index: number) => void;
  setEnvVar: (name: string, value: string) => void;
  setServerName: (name: string) => void;
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

  // The Add button is enabled only when the (debounced) content validates.
  const canAdd =
    selection !== undefined && selection.idIsValid && !selection.idIsDuplicate;

  const packages: PackageInfo[] | undefined = parsed?.options.map((o) => ({
    registryType: o.registryType,
    identifier: o.identifier,
    runtimeHint: o.runtimeHint,
  }));

  const envVars: EnvVarInfo[] = (selectedOption?.envVars ?? []).map((v) => ({
    name: v.name,
    description: v.description,
    required: v.required,
    value: draft.envOverrides[v.name] ?? v.default ?? "",
  }));

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

  async function pickFile(file: File | null) {
    if (!file) return;
    setSubmitError(undefined);
    setFileContentsHighlight(false);
    try {
      const text = await file.text();
      setDraft((d) => ({ ...d, rawText: text }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submit(): Promise<boolean> {
    setSubmitError(undefined);
    // Parse the live text (not the debounced copy) so a click in the brief
    // window after an edit (before the button re-disables) sees the latest
    // content rather than importing stale input.
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
    try {
      await onAddServer(sel.serverId, config);
      return true;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  return {
    draft: { ...draft, selectedPackageIndex: selectedIndex },
    validation: allValidation,
    packages,
    envVars,
    canAdd,
    defaultServerName: parsed?.serverName ?? "",
    fileContentsOpen,
    fileContentsHighlight,
    setRawText,
    selectPackage,
    setEnvVar,
    setServerName,
    pickFile,
    setFileContentsOpen,
    submit,
  };
}
