import { useCallback, useState } from "react";
import { useStdout } from "ink";
import { copyViaOsc52, writeCopyFile } from "../utils/clipboard.js";

/** Copy to the terminal clipboard (OSC 52). Vim's "yank". */
export const COPY_KEY = "y";
/** Save to a temp file — the fallback for a terminal without OSC 52. */
export const SAVE_KEY = "w";

export interface CopyStatus {
  tone: "success" | "warning" | "error";
  message: string;
}

/**
 * The copy affordance shared by every TUI surface that offers one (#2421):
 * `Y` sends the value to the terminal clipboard over OSC 52, and `W` saves it
 * to a private temp file for terminals that ignore OSC 52.
 *
 * The caller owns its `useInput` handler (focus and modal gating differ per
 * surface) and forwards keys to `handleCopyKey`, which reports whether it
 * consumed the key. `value` is read at keypress time, so it may be undefined
 * when there is nothing to copy — the keys are then not consumed.
 */
export function useCopyKeys(value: string | undefined, label: string) {
  const { stdout } = useStdout();
  const [status, setStatus] = useState<CopyStatus | null>(null);
  // A status describes the value it was produced for; once the value changes
  // (another server's token, another entry) it would describe the wrong one.
  // Cleared during render — React's "adjusting state on a prop change"
  // pattern — so the stale line is never painted.
  const [statusFor, setStatusFor] = useState(value);
  if (statusFor !== value) {
    setStatusFor(value);
    setStatus(null);
  }

  const handleCopyKey = useCallback(
    (input: string): boolean => {
      if (value === undefined) return false;
      const key = input.toLowerCase();
      if (key === COPY_KEY) {
        const result = copyViaOsc52(value, stdout);
        setStatus(
          result.large
            ? {
                tone: "warning",
                message: `Sent ${label} (${result.chars} chars) to the clipboard via OSC 52. Large payloads may be truncated or dropped by the terminal — press W to save it to a file instead.`,
              }
            : {
                tone: "success",
                message: `Copied ${label} (${result.chars} chars) via OSC 52. Nothing pasted? Your terminal may not support OSC 52 — press W to save it to a file.`,
              },
        );
        return true;
      }
      if (key === SAVE_KEY) {
        try {
          const file = writeCopyFile(value);
          setStatus({ tone: "success", message: `Saved ${label} to ${file}` });
        } catch (err) {
          setStatus({
            tone: "error",
            message: `Could not save ${label}: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return true;
      }
      return false;
    },
    [value, label, stdout],
  );

  return { handleCopyKey, status };
}

/** Ink colour for a {@link CopyStatus} tone. */
export function copyStatusColor(tone: CopyStatus["tone"]): string {
  return tone === "success" ? "green" : tone === "warning" ? "yellow" : "red";
}
