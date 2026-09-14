/**
 * Terminal UI for a mid-`rpc` elicitation exchange (dual-era support). Covers
 * both delivery mechanisms (legacy server→client request, modern non-task
 * MRTR round) and both modes:
 *
 * - **URL mode** mirrors the web client's convention
 *   (`InlineElicitationRequest`/`PendingClientRequestModal`): the actual
 *   out-of-band completion can't be observed here, so the user self-reports
 *   it by answering a confirm prompt — there is no "decline" for URL mode,
 *   only accept (they say they finished) or cancel.
 * - **Form mode** renders one prompt per field from the schema (see
 *   `form-schema.ts`/`form-prompt.ts`), with a review step before submitting.
 *   Schemas outside the spec's restricted primitive-field shape (should
 *   never happen from a well-behaved server) fall back to a clear decline.
 */
import { createInterface } from "node:readline/promises";
import type { Style } from "@inspector/cli/style.js";
import type {
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "../daemon/protocol.js";
import { parseFormSchema } from "./form-schema.js";
import { promptForm } from "./form-prompt.js";

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
    const fields = parseFormSchema(frame.requestedSchema);
    if (!fields) {
      // Schema outside the spec's restricted primitive-field shape —
      // shouldn't happen from a well-behaved server; decline clearly rather
      // than silently guessing at field values.
      process.stderr.write(
        style.yellow(
          "This server's form request uses a schema mcpi doesn't support " +
            "— declining.\n",
        ) + `  ${frame.message}\n`,
      );
      return declineResponse(frame);
    }

    if (!opts.interactive) {
      process.stderr.write(
        style.yellow(
          "This server is asking for form input, which requires an " +
            "interactive terminal — declining.\n",
        ) + `  ${frame.message}\n`,
      );
      return declineResponse(frame);
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const outcome = await promptForm(rl, frame.message, fields, style);
      if (outcome.action === "accept") {
        return {
          id: frame.id,
          kind: "elicitation-response",
          elicitationId: frame.elicitationId,
          action: "accept",
          content: outcome.content,
        };
      }
      if (outcome.action === "decline") return declineResponse(frame);
      return cancelResponse(frame);
    } catch {
      return cancelResponse(frame);
    } finally {
      rl.close();
    }
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
