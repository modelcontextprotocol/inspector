import { Badge, Group, Text } from "@mantine/core";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";

export interface MrtrOriginNoteProps {
  /**
   * How the pending request reached the Inspector. `"server-request"` (the
   * default) is a legacy server→client request and renders nothing, keeping the
   * panel visually identical to its pre-MRTR form. `"input-required"` is a
   * modern (2026-07-28) MRTR round and renders the era-accurate note.
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

/**
 * Era-accurate note for a pending sampling/elicitation request. On a modern
 * MRTR round (`origin: "input-required"`, SEP-2322) the request was embedded in
 * a tool-call/prompt/resource `input_required` result rather than sent as a
 * server→client JSON-RPC request, and the user's answer is echoed back to the
 * server as a retry of the original call. Legacy requests
 * (`origin: "server-request"`) render nothing so their panels are unchanged.
 */
export function MrtrOriginNote({
  origin = "server-request",
}: MrtrOriginNoteProps) {
  if (origin !== "input-required") return null;
  return (
    <NoteRow>
      <Badge variant="outline" color="blue">
        input_required
      </Badge>
      <NoteText>
        The server returned input_required; your answer is sent back as a retry
        of the original request (MRTR).
      </NoteText>
    </NoteRow>
  );
}
