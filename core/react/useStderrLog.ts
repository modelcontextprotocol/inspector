import { useState, useEffect } from "react";
import type { StderrLogEntry } from "../mcp/types.js";
import type { StderrLogState } from "../mcp/state/stderrLogState.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { StderrLogStateEventMap } from "../mcp/state/stderrLogState.js";

export interface UseStderrLogResult {
  stderrLogs: StderrLogEntry[];
}

/**
 * React hook that subscribes to StderrLogState and returns the stderr log list.
 */
export function useStderrLog(
  stderrLogState: StderrLogState | null,
): UseStderrLogResult {
  const [stderrLogs, setStderrLogs] = useState<StderrLogEntry[]>(
    stderrLogState?.getStderrLogs() ?? [],
  );

  useEffect(() => {
    if (!stderrLogState) {
      setStderrLogs([]);
      return;
    }
    setStderrLogs(stderrLogState.getStderrLogs());
    const onStderrLogsChange = (
      event: TypedEventGeneric<StderrLogStateEventMap, "stderrLogsChange">,
    ) => {
      setStderrLogs(event.detail);
    };
    stderrLogState.addEventListener("stderrLogsChange", onStderrLogsChange);
    return () => {
      stderrLogState.removeEventListener(
        "stderrLogsChange",
        onStderrLogsChange,
      );
    };
  }, [stderrLogState]);

  return { stderrLogs };
}
