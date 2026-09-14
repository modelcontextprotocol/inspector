/**
 * Terminal UI for a mid-`rpc` elicitation exchange (dual-era support, phase
 * 1 — legacy + modern non-task MRTR, URL mode only; form-mode rendering is a
 * follow-up phase). Mirrors the web client's URL-mode convention
 * (`InlineElicitationRequest`/`PendingClientRequestModal`): the actual
 * out-of-band completion can't be observed here, so the user self-reports it
 * by answering a confirm prompt — there is no "decline" for URL mode, only
 * accept (they say they finished) or cancel.
 */
import { createInterface } from "node:readline/promises";
import type { Style } from "@inspector/cli/style.js";
import type {
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "../daemon/protocol.js";

export type PromptElicitationOpts = {
  /** False for non-interactive callers (e.g. `--format json`, non-TTY). */
  interactive: boolean;
  style: Style;
};

function cancelResponse(
  frame: ElicitationRequestFrame,
): ElicitationResponseFrame {
  return {
    id: frame.id,
    kind: "elicitation-response",
    elicitationId: frame.elicitationId,
    action: "cancel",
  };
}

function declineResponse(
  frame: ElicitationRequestFrame,
): ElicitationResponseFrame {
  return {
    id: frame.id,
    kind: "elicitation-response",
    elicitationId: frame.elicitationId,
    action: "decline",
  };
}

/**
 * Prompt the user for one elicitation exchange and return their answer.
 * Never throws — falls back to cancel/decline on any failure to read input,
 * so a mid-prompt problem always unblocks the daemon-side call.
 */
export async function promptElicitation(
  frame: ElicitationRequestFrame,
  opts: PromptElicitationOpts,
): Promise<ElicitationResponseFrame> {
  const { style } = opts;

  if (frame.mode === "form") {
    // Form rendering isn't built yet (a follow-up phase); decline clearly
    // rather than silently guessing at field values or hanging.
    process.stderr.write(
      style.yellow(
        "This server is asking for form input, which mcpi doesn't support " +
          "yet — declining.\n",
      ) + `  ${frame.message}\n`,
    );
    return declineResponse(frame);
  }

  if (!opts.interactive) {
    process.stderr.write(
      style.yellow(
        "This server is asking for input via a URL (elicitation), which " +
          "requires an interactive terminal — cancelling.\n",
      ) +
        `  ${frame.message}\n` +
        (frame.url ? `  ${frame.url}\n` : ""),
    );
    return cancelResponse(frame);
  }

  process.stderr.write(
    "\n" +
      style.bold("Action required: ") +
      frame.message +
      "\n" +
      "  " +
      style.link(frame.url ?? "", frame.url) +
      "\n\n",
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(
      "Open the URL above, complete it, then press Enter to continue " +
        "(or type 'c' to cancel): ",
    );
    if (answer.trim().toLowerCase() === "c") {
      return cancelResponse(frame);
    }
    return {
      id: frame.id,
      kind: "elicitation-response",
      elicitationId: frame.elicitationId,
      action: "accept",
    };
  } catch {
    return cancelResponse(frame);
  } finally {
    rl.close();
  }
}
