import { Badge, Group, Text } from "@mantine/core";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";

export interface MrtrOriginNoteProps {
  /**
   * How the pending request reached the Inspector. `"server-request"` (the
   * default) is a legacy server→client request and renders nothing, keeping the
   * panel visually identical to its pre-MRTR form. `"input-required"` is a
   * modern (2026-07-28) MRTR round and `"task-input-required"` is a modern task
   * (SEP-2663) round — each renders its own era-accurate note.
   */
  origin?: PendingRequestOrigin;
}

const NoteRow = Group.withProps({
  gap: "xs",
  align: "center",
  wrap: "nowrap",
});

const NoteText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

// The two modern origins differ in HOW the answer is delivered: an MRTR round
// retries the original call with the answer (SEP-2322); a task round submits it
// via a separate `tasks/update` request (SEP-2663). The note is accurate to each
// so a user debugging the wire isn't told to expect the wrong follow-up frame.
const NOTE_BY_ORIGIN: Partial<Record<PendingRequestOrigin, string>> = {
  "input-required":
    "The server returned input_required; your answer is sent back as a retry of the original request (MRTR).",
  "task-input-required":
    "This task reached input_required; your answer is submitted via a tasks/update request (SEP-2663), not a retry.",
};

/**
 * Era-accurate note for a pending sampling/elicitation request. A modern MRTR
 * round (`origin: "input-required"`, SEP-2322) embeds the request in a
 * tool-call/prompt/resource `input_required` result and retries the original
 * call with the answer; a modern task round (`origin: "task-input-required"`,
 * SEP-2663) surfaces it from the task's `inputRequests` and submits the answer
 * via `tasks/update`. Legacy requests (`origin: "server-request"`) render
 * nothing so their panels are unchanged.
 */
export function MrtrOriginNote({
  origin = "server-request",
}: MrtrOriginNoteProps) {
  const note = NOTE_BY_ORIGIN[origin];
  if (!note) return null;
  return (
    <NoteRow>
      <Badge variant="outline" color="blue">
        input_required
      </Badge>
      <NoteText>{note}</NoteText>
    </NoteRow>
  );
}
