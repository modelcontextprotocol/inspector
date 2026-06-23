import { useEffect, useMemo, useState } from "react";
import { Modal, Text } from "@mantine/core";
import {
  parseServerJson,
  buildServerConfig,
  type ParsedServerJson,
  type ServerJsonOption,
} from "@inspector/core/mcp/import/serverJson.js";
import type {
  InspectorServerJsonDraft,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import {
  ImportServerJsonPanel,
  type EnvVarInfo,
  type PackageInfo,
  type ValidationResult,
} from "../ImportServerJsonPanel/ImportServerJsonPanel";

/** Allowed id pattern — mirrors validateStoreId in core/storage/store-io.ts. */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ModalTitle = Text.withProps({ fw: 700, span: true });

export interface ServerImportJsonModalProps {
  opened: boolean;
  /** Ids already in use — drives the duplicate-id warning. */
  existingIds: string[];
  onClose: () => void;
  /** Persist the chosen server. Resolves once the catalog has been updated. */
  onAddServer: (id: string, config: MCPServerConfig) => Promise<void> | void;
}

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

/** The id the chosen server will be saved under. */
function resolveId(
  parsed: ParsedServerJson | undefined,
  override: string | undefined,
): string {
  const trimmed = (override ?? "").trim();
  if (trimmed) return trimmed;
  return parsed?.serverName ?? "";
}

/** Debounce (ms) before a textarea edit re-triggers parse/validation. */
const VALIDATE_DEBOUNCE_MS = 300;

/**
 * Delay (ms) after content is loaded/pasted before the File Contents disclosure
 * auto-collapses — long enough to read as "the content was accepted".
 */
const COLLAPSE_DELAY_MS = 1000;

interface Selection {
  parsed?: ParsedServerJson;
  selectedIndex: number;
  selectedOption?: ServerJsonOption;
  targetId: string;
  idIsValid: boolean;
  idIsDuplicate: boolean;
}

/**
 * Derive the chosen package/remote, the resulting id, and its validity from a
 * parse state + the current draft. Pure, so the render path (debounced parse)
 * and the submit path (live parse) can share it.
 */
function computeSelection(
  parseState: ParseState,
  draft: InspectorServerJsonDraft,
  existingIds: string[],
): Selection {
  const parsed = parseState.ok === true ? parseState.parsed : undefined;
  const selectedIndex = Math.min(
    draft.selectedPackageIndex ?? 0,
    Math.max((parsed?.options.length ?? 1) - 1, 0),
  );
  const selectedOption = parsed?.options[selectedIndex];
  const targetId = resolveId(parsed, draft.nameOverride);
  const idIsValid = targetId === "" || ID_PATTERN.test(targetId);
  const idIsDuplicate = targetId !== "" && existingIds.includes(targetId);
  return {
    parsed,
    selectedIndex,
    selectedOption,
    targetId,
    idIsValid,
    idIsDuplicate,
  };
}

/**
 * Wiring layer for the registry `server.json` import (#1348). Owns the draft +
 * parse state and feeds the dumb `ImportServerJsonPanel`; on "Add Server" it
 * builds the runnable config for the selected package/remote (merging the env
 * overrides the user typed) and hands it to `onAddServer`.
 */
export function ServerImportJsonModal({
  opened,
  existingIds,
  onClose,
  onAddServer,
}: ServerImportJsonModalProps) {
  const [draft, setDraft] = useState<InspectorServerJsonDraft>(EMPTY_DRAFT);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  // Debounced copy of the raw text that drives parsing/validation, so typing
  // doesn't re-parse on every keystroke. The textarea itself stays bound to the
  // live `draft.rawText`.
  const [debouncedText, setDebouncedText] = useState<string>(
    EMPTY_DRAFT.rawText,
  );
  // The File Contents disclosure starts open and auto-collapses shortly after
  // content is loaded/pasted (see the effect below).
  const [fileContentsOpen, setFileContentsOpen] = useState(true);

  // Reset the draft each time the modal transitions to open. Done during render
  // (React's "adjust state when a prop changes" pattern) rather than in an
  // effect so there's no extra commit/cascade.
  const [prevOpened, setPrevOpened] = useState(opened);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setDraft(EMPTY_DRAFT);
      setSubmitError(undefined);
      setDebouncedText(EMPTY_DRAFT.rawText);
      setFileContentsOpen(true);
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

  // Once there's content, collapse the File Contents disclosure after a beat so
  // the (animated) collapse signals that the paste/file load was accepted and
  // surfaces the validation / env-var sections below. Clearing the textarea
  // re-opens it (handled in setRawText).
  useEffect(() => {
    if (!draft.rawText.trim()) return;
    const id = setTimeout(() => setFileContentsOpen(false), COLLAPSE_DELAY_MS);
    return () => clearTimeout(id);
  }, [draft.rawText]);

  const parseState = useMemo(() => parseDraft(debouncedText), [debouncedText]);
  const {
    parsed,
    selectedIndex,
    selectedOption,
    targetId,
    idIsValid,
    idIsDuplicate,
  } = useMemo(
    () => computeSelection(parseState, draft, existingIds),
    [parseState, draft, existingIds],
  );

  // The Add button is enabled only when the (debounced) content validates: a
  // parseable server.json with a runnable option and a valid, non-duplicate id.
  const canAdd =
    parsed !== undefined &&
    selectedOption !== undefined &&
    idIsValid &&
    !idIsDuplicate;

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
    if (!idIsValid) {
      results.push({
        type: "error",
        message:
          "Server id must use only letters, numbers, hyphens, underscores.",
      });
    } else if (idIsDuplicate) {
      results.push({
        type: "warning",
        message: `A server with id "${targetId}" already exists.`,
      });
    }
    return results;
  }, [parseState, idIsValid, idIsDuplicate, targetId]);

  function setRawText(content: string) {
    setSubmitError(undefined);
    setDraft((d) => ({ ...d, rawText: content }));
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
    try {
      const text = await file.text();
      setDraft((d) => ({ ...d, rawText: text }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddServer() {
    setSubmitError(undefined);
    // Parse the live text (not the debounced copy) so a click in the brief
    // window after an edit (before the Add button has re-disabled) still sees
    // the latest content rather than importing stale input.
    const sel = computeSelection(parseDraft(draft.rawText), draft, existingIds);
    if (
      !sel.parsed ||
      !sel.selectedOption ||
      !sel.idIsValid ||
      sel.idIsDuplicate
    ) {
      setSubmitError("Fix the validation errors before adding the server.");
      return;
    }
    // Only pass overrides for env vars the selected option declares.
    const overrides: Record<string, string> = {};
    for (const v of sel.selectedOption.envVars) {
      const value = draft.envOverrides[v.name];
      if (value !== undefined) overrides[v.name] = value;
    }
    const config = buildServerConfig(sel.selectedOption, overrides);
    try {
      await onAddServer(sel.targetId, config);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  const allValidation = submitError
    ? [...validation, { type: "error" as const, message: submitError }]
    : validation;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      title={<ModalTitle>Import MCP Registry server.json</ModalTitle>}
    >
      <ImportServerJsonPanel
        draft={{ ...draft, selectedPackageIndex: selectedIndex }}
        validation={allValidation}
        packages={packages}
        envVars={envVars}
        onJsonChange={setRawText}
        onSelectPackage={selectPackage}
        onEnvVarChange={setEnvVar}
        onServerNameChange={setServerName}
        onAddServer={() => void handleAddServer()}
        addDisabled={!canAdd}
        fileContentsOpen={fileContentsOpen}
        onFileContentsChange={setFileContentsOpen}
        onCancel={onClose}
        onPickFile={(file) => void pickFile(file)}
      />
    </Modal>
  );
}
