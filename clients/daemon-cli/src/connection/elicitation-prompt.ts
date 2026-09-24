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
import { promptForm, watchForClose } from "./form-prompt.js";
import { sanitizeText } from "./sanitize.js";

export type PromptElicitationOpts = {
  /**
   * False only for callers where a text prompt can't sensibly be shown
   * (currently just `--format json`, whose stdout is a single
   * machine-readable payload). A prompt works the same over a plain,
   * non-TTY stdin/stderr as it does at a real terminal — a human at a
   * keyboard and an agent relaying/answering on their behalf both just
   * read a line of text and reply with one. A stdin that's already closed
   * (e.g. `mcpdo ... </dev/null`) is handled by declining/cancelling once
   * reading fails, not by refusing to try in the first place.
   */
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
  // Server-controlled display strings must not reach the terminal raw
  // (escape injection — see sanitize.ts). Protocol ids on `frame` stay
  // untouched so responses still correlate.
  const message = sanitizeText(frame.message);
  const url = frame.url === undefined ? undefined : sanitizeText(frame.url);

  if (frame.mode === "form") {
    // The schema is parsed raw: sanitizing it wholesale would mutate protocol
    // data (property names, enum values, defaults), so the accepted response
    // could carry keys/values the server never defined. Server-controlled
    // strings are instead sanitized at each render point in form-prompt.ts.
    const fields = parseFormSchema(frame.requestedSchema);
    if (!fields) {
      // Schema outside the spec's restricted primitive-field shape —
      // shouldn't happen from a well-behaved server; decline clearly rather
      // than silently guessing at field values.
      process.stderr.write(
        style.yellow(
          "This server's form request uses a schema mcpdo doesn't support " +
            "— declining.\n",
        ) + `  ${message}\n`,
      );
      return declineResponse(frame);
    }

    if (!opts.interactive) {
      process.stderr.write(
        style.yellow(
          "This server is asking for form input, which isn't supported " +
            "with --format json — declining.\n",
        ) + `  ${message}\n`,
      );
      return declineResponse(frame);
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const outcome = await promptForm(rl, message, fields, style);
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
          "isn't supported with --format json — cancelling.\n",
      ) +
        `  ${message}\n` +
        (url ? `  ${url}\n` : ""),
    );
    return cancelResponse(frame);
  }

  process.stderr.write(
    "\n" +
      style.bold("Action required: ") +
      message +
      "\n" +
      "  " +
      style.link(url ?? "", url) +
      "\n\n",
  );

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await Promise.race([
      rl.question(
        "Open the URL above, complete it, then press Enter to continue " +
          "(or type 'c' to cancel): ",
      ),
      watchForClose(rl),
    ]);
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
