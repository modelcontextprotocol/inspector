import { useRef, useState } from "react";
import { Group, Modal, Text } from "@mantine/core";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
  ElicitRequestFormParams,
  ElicitResult,
} from "@modelcontextprotocol/client";
import { SamplingRequestPanel } from "../SamplingRequestPanel/SamplingRequestPanel";
import { ElicitationFormPanel } from "../ElicitationFormPanel/ElicitationFormPanel";
import { ElicitationUrlPanel } from "../ElicitationUrlPanel/ElicitationUrlPanel";
import {
  collectSchemaDefaults,
  type InspectorFormSchema,
} from "../../../utils/jsonUtils";

/**
 * The server-initiated request currently shown in the modal. `id` is the
 * client-side request id; it keys the modal body so per-request draft state
 * resets when the active request changes.
 */
export type PendingClientRequestContent =
  | { kind: "sampling"; id: string; request: CreateMessageRequestParams }
  | { kind: "elicitation-form"; id: string; request: ElicitRequestFormParams }
  | { kind: "elicitation-url"; id: string; message: string; url: string };

export interface PendingClientRequestModalProps {
  /** The active request to display, or null when nothing is pending. */
  request: PendingClientRequestContent | null;
  /** Display name of the connected server (shown in elicitation warnings). */
  serverName: string;
  /**
   * Count label for the still-pending requests, e.g. "3 pending". The modal
   * always shows the head of the queue, so this is a remaining-count hint, not
   * a navigable position. Empty string hides the label (nothing else queued).
   */
  queuePosition: string;
  /** Resolve a sampling request with the given (drafted or auto) result. */
  onSamplingRespond: (result: CreateMessageResult) => void;
  /** Reject the active sampling request. */
  onSamplingReject: () => void;
  /** Resolve an elicitation request (accept/decline/cancel). */
  onElicitationRespond: (result: ElicitResult) => void;
}

const TitleRow = Group.withProps({
  justify: "space-between",
  gap: "md",
  w: "100%",
  wrap: "nowrap",
});

const TitleText = Text.withProps({ fw: 600 });

const QueueLabel = Text.withProps({ size: "xs", c: "dimmed" });

/**
 * The stub result pre-filled into a sampling draft. "Send Response" sends this
 * as-is when untouched, or whatever the user edited it into.
 */
function createDefaultSamplingResult(): CreateMessageResult {
  return {
    model: "stub-model",
    stopReason: "endTurn",
    role: "assistant",
    content: { type: "text", text: "" },
  };
}

function titleFor(content: PendingClientRequestContent): string {
  return content.kind === "sampling"
    ? "Sampling Request"
    : "Elicitation Request";
}

// Empty handler — the modal is intentionally non-dismissable; the request is
// only resolved via an explicit action button so the blocked call never hangs
// on an accidental dismissal.
function ignoreClose(): void {}

/**
 * Returns a `responded` flag and a `once()` wrapper. The first invocation of
 * any wrapped callback flips `responded` (to lock the panel's actions) and
 * runs it; later invocations no-op. The ref makes the guard synchronous so a
 * fast double-click can't resolve the request twice before the modal unmounts
 * — respond()/reject() throw if called again. Reset per request via the body's
 * `key`.
 */
function useRespondOnce(): {
  responded: boolean;
  once: (fn: () => void) => () => void;
} {
  const [responded, setResponded] = useState(false);
  const respondedRef = useRef(false);
  const once = (fn: () => void) => () => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    setResponded(true);
    fn();
  };
  return { responded, once };
}

function SamplingModalBody({
  request,
  onRespond,
  onReject,
}: {
  request: CreateMessageRequestParams;
  onRespond: (result: CreateMessageResult) => void;
  onReject: () => void;
}) {
  const [draftResult, setDraftResult] = useState<CreateMessageResult>(
    createDefaultSamplingResult,
  );
  const { responded, once } = useRespondOnce();
  return (
    <SamplingRequestPanel
      request={request}
      draftResult={draftResult}
      onResultChange={setDraftResult}
      onSend={once(() => onRespond(draftResult))}
      onReject={once(onReject)}
      busy={responded}
    />
  );
}

function ElicitationFormModalBody({
  request,
  serverName,
  onRespond,
}: {
  request: ElicitRequestFormParams;
  serverName: string;
  onRespond: (result: ElicitResult) => void;
}) {
  // Seed with the schema's defaults so default-only fields the user never
  // touches are still included on submit (the form shows them via
  // resolveValue, but onChange only writes edited fields). The modal body is
  // keyed by request id, so this lazy initializer re-runs per request.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    collectSchemaDefaults(request.requestedSchema as InspectorFormSchema),
  );
  const { responded, once } = useRespondOnce();
  return (
    <ElicitationFormPanel
      request={request}
      serverName={serverName}
      values={values}
      onChange={setValues}
      onSubmit={once(() =>
        onRespond({
          action: "accept",
          content: values as ElicitResult["content"],
        }),
      )}
      onDecline={once(() => onRespond({ action: "decline" }))}
      onCancel={once(() => onRespond({ action: "cancel" }))}
      busy={responded}
    />
  );
}

function ElicitationUrlModalBody({
  id,
  message,
  url,
  onRespond,
}: {
  id: string;
  message: string;
  url: string;
  onRespond: (result: ElicitResult) => void;
}) {
  const [isWaiting, setIsWaiting] = useState(false);
  const { responded, once } = useRespondOnce();
  return (
    <ElicitationUrlPanel
      message={message}
      url={url}
      requestId={id}
      isWaiting={isWaiting}
      onCopyUrl={() => {
        void navigator.clipboard?.writeText(url);
        // Copying the URL is the other way to start the external flow (paste
        // into a browser). Reveal the completion step too, otherwise a user who
        // copies rather than clicking "Open in Browser" could only Cancel.
        setIsWaiting(true);
      }}
      onOpenInBrowser={() => {
        window.open(url, "_blank", "noopener,noreferrer");
        // Opening the URL only moves the panel into its waiting state — the
        // inspector can't observe completion of an external flow, so the
        // elicitation resolves only when the user explicitly confirms
        // completion (accept) or cancels.
        setIsWaiting(true);
      }}
      onComplete={once(() => onRespond({ action: "accept" }))}
      onCancel={once(() => onRespond({ action: "cancel" }))}
      busy={responded}
    />
  );
}

/**
 * App-level modal that surfaces a server-initiated sampling/elicitation request
 * while a call (e.g. a tool execution) is in flight. Responding resolves the
 * client's handler Promise, which unblocks the originating call.
 */
export function PendingClientRequestModal({
  request,
  serverName,
  queuePosition,
  onSamplingRespond,
  onSamplingReject,
  onElicitationRespond,
}: PendingClientRequestModalProps) {
  return (
    <Modal
      opened={request !== null}
      onClose={ignoreClose}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      size="lg"
      title={
        request && (
          <TitleRow>
            <TitleText>{titleFor(request)}</TitleText>
            {queuePosition && <QueueLabel>{queuePosition}</QueueLabel>}
          </TitleRow>
        )
      }
    >
      {request?.kind === "sampling" && (
        <SamplingModalBody
          key={request.id}
          request={request.request}
          onRespond={onSamplingRespond}
          onReject={onSamplingReject}
        />
      )}
      {request?.kind === "elicitation-form" && (
        <ElicitationFormModalBody
          key={request.id}
          request={request.request}
          serverName={serverName}
          onRespond={onElicitationRespond}
        />
      )}
      {request?.kind === "elicitation-url" && (
        <ElicitationUrlModalBody
          key={request.id}
          id={request.id}
          message={request.message}
          url={request.url}
          onRespond={onElicitationRespond}
        />
      )}
    </Modal>
  );
}
