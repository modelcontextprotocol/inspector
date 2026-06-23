import { useMemo, useState } from "react";
import {
  parseClientConfig,
  planImport,
  uniqueId,
  type ConflictResolution,
  type ImportPlan,
  type ImportSourceResult,
} from "@inspector/core/mcp/import/index.js";
import { validateStoreId } from "@inspector/core/storage/store-id.js";
import type { MCPConfig, MCPServerConfig } from "@inspector/core/mcp/types.js";

export type ImportPhase = "select" | "loading" | "review" | "summary";

export interface ConflictResolutionState {
  action: ConflictResolution;
  renameTo: string;
}

/** Per-row choice for a brand-new (non-conflicting) server. */
export type AdditionAction = "import" | "skip";

export interface ImportOutcome {
  id: string;
  status: "added" | "overwritten" | "renamed" | "skipped" | "failed";
  detail?: string;
}

export interface UseImportClientConfigOptions {
  opened: boolean;
  /** Ids already in the catalog — drives conflict detection + rename defaults. */
  existingIds: string[];
  /** Read a client's well-known config on the backend (authed GET). */
  onFetchSource: (type: string) => Promise<ImportSourceResult>;
  onAddServer: (id: string, config: MCPServerConfig) => Promise<void>;
  onUpdateServer: (
    originalId: string,
    newId: string,
    config: MCPServerConfig,
  ) => Promise<void>;
}

export interface ImportClientConfigViewModel {
  phase: ImportPhase;
  error?: string;
  notice?: string;
  plan: ImportPlan | null;
  resolutions: Record<string, ConflictResolutionState>;
  additionActions: Record<string, AdditionAction>;
  outcomes: ImportOutcome[];
  selectedType: string | null;
  importCount: number;
  /** Per-conflict validation message for an invalid/colliding rename target. */
  renameErrors: Record<string, string>;
  /** True when there's something to import and no rename is invalid. */
  canImport: boolean;
  setSelectedType: (type: string | null) => void;
  pickSource: (type: string) => Promise<void>;
  pickFile: (file: File | null) => Promise<void>;
  setResolution: (id: string, action: ConflictResolution) => void;
  setRenameTo: (id: string, renameTo: string) => void;
  setAdditionAction: (id: string, action: AdditionAction) => void;
  runImport: () => Promise<void>;
  back: () => void;
}

/**
 * Wiring for the "Import from client config" flow (#1348): owns the wizard phase,
 * the parsed plan, per-server resolutions, and the apply loop. Keeps
 * `ServerImportConfigModal` a thin display component; the reusable parsing +
 * merge logic lives in `core/mcp/import`.
 */
export function useImportClientConfig({
  opened,
  existingIds,
  onFetchSource,
  onAddServer,
  onUpdateServer,
}: UseImportClientConfigOptions): ImportClientConfigViewModel {
  const [phase, setPhase] = useState<ImportPhase>("select");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [incoming, setIncoming] = useState<MCPConfig | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, ConflictResolutionState>
  >({});
  const [additionActions, setAdditionActions] = useState<
    Record<string, AdditionAction>
  >({});
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Reset the wizard each time the modal transitions to open. Done during
  // render (React's "adjust state when a prop changes" pattern) rather than in
  // an effect so there's no extra commit/cascade.
  const [prevOpened, setPrevOpened] = useState(opened);
  if (opened !== prevOpened) {
    setPrevOpened(opened);
    if (opened) {
      setPhase("select");
      setError(undefined);
      setNotice(undefined);
      setIncoming(null);
      setResolutions({});
      setAdditionActions({});
      setOutcomes([]);
      setSelectedType(null);
    }
  }

  const plan = useMemo(
    () => (incoming ? planImport(incoming, existingIds) : null),
    [incoming, existingIds],
  );

  function beginReview(config: MCPConfig) {
    const fresh = planImport(config, existingIds);
    if (fresh.additions.length === 0 && fresh.conflicts.length === 0) {
      setError("No servers found in the selected source.");
      setPhase("select");
      return;
    }
    const taken = [...existingIds, ...fresh.additions.map((a) => a.id)];
    const initial: Record<string, ConflictResolutionState> = {};
    for (const conflict of fresh.conflicts) {
      initial[conflict.id] = {
        action: "skip",
        renameTo: uniqueId(conflict.id, taken),
      };
    }
    // New servers default to "import"; the user can opt individual ones out.
    const initialAdds: Record<string, AdditionAction> = {};
    for (const add of fresh.additions) {
      initialAdds[add.id] = "import";
    }
    setIncoming(config);
    setResolutions(initial);
    setAdditionActions(initialAdds);
    setError(undefined);
    setPhase("review");
  }

  async function pickSource(type: string) {
    setPhase("loading");
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await onFetchSource(type);
      if (result.error) {
        setError(result.error);
        setPhase("select");
        return;
      }
      if (!result.found || !result.config) {
        setNotice(
          `No config found. Searched: ${result.searched.join(", ")}. Try uploading a file instead.`,
        );
        setPhase("select");
        return;
      }
      beginReview(result.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("select");
    }
  }

  async function pickFile(file: File | null) {
    if (!file) return;
    setError(undefined);
    setNotice(undefined);
    try {
      const raw = await file.text();
      beginReview(parseClientConfig(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setResolution(id: string, action: ConflictResolution) {
    setResolutions((r) => ({ ...r, [id]: { ...r[id], action } }));
  }

  function setRenameTo(id: string, renameTo: string) {
    setResolutions((r) => ({ ...r, [id]: { ...r[id], renameTo } }));
  }

  function setAdditionAction(id: string, action: AdditionAction) {
    setAdditionActions((a) => ({ ...a, [id]: action }));
  }

  async function applyEntry(
    id: string,
    outcome: ImportOutcome["status"],
    write: () => Promise<void>,
  ): Promise<ImportOutcome> {
    try {
      await write();
      return { id, status: outcome };
    } catch (err) {
      return {
        id,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function runImport() {
    if (!plan) return;
    setPhase("loading");
    const results: ImportOutcome[] = [];
    for (const add of plan.additions) {
      if ((additionActions[add.id] ?? "import") === "skip") {
        results.push({ id: add.id, status: "skipped" });
        continue;
      }
      results.push(
        await applyEntry(add.id, "added", () =>
          Promise.resolve(onAddServer(add.id, add.config)),
        ),
      );
    }
    for (const conflict of plan.conflicts) {
      const res = resolutions[conflict.id] ?? {
        action: "skip",
        renameTo: conflict.id,
      };
      if (res.action === "skip") {
        results.push({ id: conflict.id, status: "skipped" });
      } else if (res.action === "overwrite") {
        results.push(
          await applyEntry(conflict.id, "overwritten", () =>
            onUpdateServer(conflict.id, conflict.id, conflict.config),
          ),
        );
      } else {
        const newId = res.renameTo.trim() || conflict.id;
        results.push(
          await applyEntry(newId, "renamed", () =>
            Promise.resolve(onAddServer(newId, conflict.config)),
          ),
        );
      }
    }
    setOutcomes(results);
    setPhase("summary");
  }

  const importCount = plan
    ? plan.additions.filter(
        (a) => (additionActions[a.id] ?? "import") === "import",
      ).length +
      plan.conflicts.filter(
        (c) => (resolutions[c.id]?.action ?? "skip") !== "skip",
      ).length
    : 0;

  // Validate each "rename" target inline: it must be a syntactically valid id
  // that doesn't collide with an existing server, an imported addition, or
  // another rename target — so the user learns before submitting rather than
  // getting a 409 in the summary.
  const renameErrors = useMemo<Record<string, string>>(() => {
    if (!plan) return {};
    const errors: Record<string, string> = {};
    for (const conflict of plan.conflicts) {
      const res = resolutions[conflict.id];
      if (res?.action !== "rename") continue;
      const newId = res.renameTo.trim();
      if (!newId) {
        errors[conflict.id] = "A new id is required.";
        continue;
      }
      if (!validateStoreId(newId)) {
        errors[conflict.id] =
          "Use only letters, numbers, hyphens, underscores.";
        continue;
      }
      // Ids that would already exist alongside this rename.
      const taken = new Set<string>(existingIds);
      for (const add of plan.additions) {
        if ((additionActions[add.id] ?? "import") === "import") {
          taken.add(add.id);
        }
      }
      for (const other of plan.conflicts) {
        if (other.id === conflict.id) continue;
        const r = resolutions[other.id];
        if (r?.action === "rename") taken.add(r.renameTo.trim());
      }
      if (taken.has(newId)) {
        errors[conflict.id] = `"${newId}" is already in use.`;
      }
    }
    return errors;
  }, [plan, resolutions, additionActions, existingIds]);

  const canImport = importCount > 0 && Object.keys(renameErrors).length === 0;

  return {
    phase,
    error,
    notice,
    plan,
    resolutions,
    additionActions,
    outcomes,
    selectedType,
    importCount,
    renameErrors,
    canImport,
    setSelectedType,
    pickSource,
    pickFile,
    setResolution,
    setRenameTo,
    setAdditionAction,
    runImport,
    back: () => setPhase("select"),
  };
}
