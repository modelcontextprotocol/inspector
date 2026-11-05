/**
 * Full-screen modal for a server-initiated request awaiting the user (#2829):
 * `sampling/createMessage` and `elicitation/create`, in both form and URL mode.
 *
 * These arrive while a call is in flight — typically a tool the user just ran
 * from `ToolTestModal` — and block it until answered, so App renders this
 * above every other overlay and holds their keys off while it is open. One
 * request is shown at a time, sampling first, the same order the web client's
 * `PendingClientRequestModal` uses; settling it removes it from core's queue,
 * which re-renders this with the next one or unmounts it.
 *
 * The forms are `ink-form`, built from the same `schemaToForm` the tool modal
 * uses. ink-form owns Enter and the arrows, and Esc while a field is being
 * edited — so Esc here never settles a request outright: it opens a one-line
 * prompt naming the dismissal keys, and any other key backs out of it. That
 * keeps "stop editing this field" from silently declining the whole request.
 * The form stays mounted under the prompt, so nothing typed into it is lost.
 */
import React, { useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { Form } from "ink-form";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { SamplingCreateMessage } from "@inspector/core/mcp/samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage.js";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";
import type { ElicitResult } from "@modelcontextprotocol/client";
import {
  SAMPLING_RESPONSE_FORM,
  describeSamplingRequest,
  elicitationContentFromForm,
  elicitationForm,
  elicitationUrlRefusal,
  samplingResultFromForm,
  type ElicitFormParams,
} from "../utils/pendingRequests.js";
import { errorMessage } from "../utils/errorText.js";
import { openUrl } from "../utils/openUrl.js";

interface PendingRequestModalProps {
  pendingSamples: readonly SamplingCreateMessage[];
  pendingElicitations: readonly ElicitationCreateMessage[];
  /** Needed only to cancel the task behind a task-input-required request. */
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
}

/**
 * A synchronous once-guard: two keys can land before React re-renders, and
 * core's `respond()` throws on a second settle.
 */
function useOnce(): (fn: () => void) => void {
  const doneRef = useRef(false);
  return (fn) => {
    if (doneRef.current) return;
    doneRef.current = true;
    fn();
  };
}

/** The line explaining how a request reached us, or null for the plain case. */
function originNote(
  origin: PendingRequestOrigin,
  taskId: string | undefined,
): string | null {
  if (origin === "task-input-required") {
    return `Requested by task ${taskId ?? "(unknown)"} (input_required)`;
  }
  if (origin === "input-required") {
    return "Requested mid-call (input_required round)";
  }
  return null;
}

function ModalFrame({
  title,
  hint,
  queueLabel,
  note,
  status,
  width,
  height,
  children,
}: {
  title: string;
  hint: string;
  queueLabel: string;
  note: string | null;
  status: string | null;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={width - 2}
        height={height - 2}
        borderStyle="single"
        borderColor="yellow"
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor="black"
      >
        <Box flexShrink={0}>
          <Text bold color="yellow">
            {title}
          </Text>
          {queueLabel && <Text dimColor> ({queueLabel})</Text>}
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>{hint}</Text>
        </Box>
        {note && (
          <Box flexShrink={0}>
            <Text dimColor>{note}</Text>
          </Box>
        )}
        {status && (
          <Box flexShrink={0}>
            <Text color="red">{status}</Text>
          </Box>
        )}
        <Box
          flexGrow={1}
          flexDirection="column"
          overflow="hidden"
          marginTop={1}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/** The bar shown while Esc's dismissal prompt is open. */
function DismissPrompt({ choices }: { choices: string }) {
  return (
    <Box flexShrink={0}>
      <Text color="yellow">{choices}</Text>
    </Box>
  );
}

function SamplingRequest({
  sample,
  queueLabel,
  width,
  height,
}: {
  sample: SamplingCreateMessage;
  queueLabel: string;
  width: number;
  height: number;
}) {
  const once = useOnce();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);

  const settle = (action: () => Promise<void>) =>
    once(() => {
      // A key handler cannot await; the catch surfaces a failed settle.
      action().catch((err: unknown) => setStatus(errorMessage(err)));
    });

  useInput((input: string, key: Key) => {
    if (confirming) {
      // Any other key backs out — including Enter, which ink-form also takes
      // to start editing a field, so a later `r` typed there is text, not a
      // rejection.
      setConfirming(false);
      if (input === "r") {
        settle(() =>
          sample.reject(new Error("Sampling request rejected by user.")),
        );
      }
      return;
    }
    if (key.escape) {
      setConfirming(true);
    } else if (key.pageDown) {
      scrollViewRef.current?.scrollBy(1);
    } else if (key.pageUp) {
      scrollViewRef.current?.scrollBy(-1);
    }
  });

  const summaryHeight = Math.max(3, Math.floor((height - 8) * 0.4));
  return (
    <ModalFrame
      title="Sampling request"
      hint="(Enter on Submit to approve, ESC to reject, PgUp/PgDn to scroll)"
      queueLabel={queueLabel}
      note={originNote(sample.origin, sample.taskId)}
      status={status}
      width={width}
      height={height}
    >
      <Box
        height={summaryHeight}
        flexShrink={0}
        flexDirection="column"
        overflow="hidden"
      >
        <ScrollView ref={scrollViewRef}>
          {describeSamplingRequest(sample.request.params).map((line, idx) => (
            <Text key={idx}>{line || " "}</Text>
          ))}
        </ScrollView>
      </Box>
      {confirming && (
        <DismissPrompt choices="Reject this sampling request? r: reject   any other key: back" />
      )}
      <Box flexGrow={1} width="100%">
        <Form
          form={SAMPLING_RESPONSE_FORM}
          onSubmit={(values: object) =>
            settle(() =>
              sample.respond(
                samplingResultFromForm(values as Record<string, unknown>),
              ),
            )
          }
        />
      </Box>
    </ModalFrame>
  );
}

/**
 * Settle an elicitation. Cancelling a MODERN task's input_required request
 * means "give up on the task", not "send a cancel answer" — which a server
 * that does not advance would just re-prompt on — so it cancels the task
 * instead, exactly as the web client does (#1631).
 */
function settleElicitation(
  elicitation: ElicitationCreateMessage,
  result: ElicitResult,
  inspectorClient: InspectorClient | null,
): Promise<void> {
  if (
    result.action === "cancel" &&
    elicitation.origin === "task-input-required" &&
    elicitation.taskId &&
    inspectorClient
  ) {
    return inspectorClient.cancelRequestorTask(elicitation.taskId);
  }
  return elicitation.respond(result);
}

function ElicitationFormRequest({
  elicitation,
  params,
  inspectorClient,
  queueLabel,
  width,
  height,
}: {
  elicitation: ElicitationCreateMessage;
  params: ElicitFormParams;
  inspectorClient: InspectorClient | null;
  queueLabel: string;
  width: number;
  height: number;
}) {
  const once = useOnce();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Built once per request (the component is keyed by its id), so a
  // re-render never hands ink-form a fresh structure mid-edit.
  const [form] = useState(() => elicitationForm(params.requestedSchema));

  const settle = (result: ElicitResult) =>
    once(() => {
      // A key handler cannot await; the catch surfaces a failed settle.
      settleElicitation(elicitation, result, inspectorClient).catch(
        (err: unknown) => setStatus(errorMessage(err)),
      );
    });

  useInput((input: string, key: Key) => {
    if (confirming) {
      // Any other key backs out — see the sampling prompt above for why.
      setConfirming(false);
      if (input === "d") {
        settle({ action: "decline" });
      } else if (input === "c") {
        settle({ action: "cancel" });
      }
      return;
    }
    if (key.escape) setConfirming(true);
  });

  const handleSubmit = (values: Record<string, unknown>) => {
    const outcome = elicitationContentFromForm(params.requestedSchema, values);
    if ("missing" in outcome) {
      setStatus(
        `Missing required field${outcome.missing.length > 1 ? "s" : ""}: ${outcome.missing.join(", ")}`,
      );
      return;
    }
    settle(outcome.result);
  };

  return (
    <ModalFrame
      title="Elicitation request"
      hint="(Enter on Submit to accept, ESC to decline or cancel)"
      queueLabel={queueLabel}
      note={originNote(elicitation.origin, elicitation.taskId)}
      status={status}
      width={width}
      height={height}
    >
      <Box flexShrink={0} marginBottom={1}>
        <Text>{params.message}</Text>
      </Box>
      {confirming && (
        <DismissPrompt choices="Dismiss this request? d: decline   c: cancel   any other key: back" />
      )}
      <Box flexGrow={1} width="100%">
        <Form
          form={form}
          onSubmit={(values: object) =>
            handleSubmit(values as Record<string, unknown>)
          }
        />
      </Box>
    </ModalFrame>
  );
}

function ElicitationUrlRequest({
  elicitation,
  message,
  url,
  inspectorClient,
  queueLabel,
  width,
  height,
}: {
  elicitation: ElicitationCreateMessage;
  message: string;
  url: string;
  inspectorClient: InspectorClient | null;
  queueLabel: string;
  width: number;
  height: number;
}) {
  const once = useOnce();
  const [status, setStatus] = useState<string | null>(null);
  const refusal = elicitationUrlRefusal(url);

  const settle = (result: ElicitResult) =>
    once(() => {
      // A key handler cannot await; the catch surfaces a failed settle.
      settleElicitation(elicitation, result, inspectorClient).catch(
        (err: unknown) => setStatus(errorMessage(err)),
      );
    });

  // No form here, so every key is ours and Esc can cancel directly.
  useInput((input: string, key: Key) => {
    if (input === "o") {
      if (refusal) {
        setStatus(refusal);
        return;
      }
      // openUrl never rejects; a browser that could not be launched reports
      // the manual-open note through the callback instead.
      void openUrl(url, setStatus);
    } else if (key.return) {
      settle({ action: "accept" });
    } else if (input === "d") {
      settle({ action: "decline" });
    } else if (key.escape || input === "c") {
      settle({ action: "cancel" });
    }
  });

  return (
    <ModalFrame
      title="Elicitation request (URL)"
      hint="(o: open in browser, Enter: done, d: decline, ESC: cancel)"
      queueLabel={queueLabel}
      note={originNote(elicitation.origin, elicitation.taskId)}
      status={status}
      width={width}
      height={height}
    >
      <Box flexShrink={0} marginBottom={1}>
        <Text>{message}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text color="cyan">{url}</Text>
      </Box>
      <Box flexShrink={0} marginTop={1}>
        <Text dimColor>
          Complete the flow in your browser, then press Enter. The Inspector
          cannot observe the external flow finishing.
        </Text>
      </Box>
    </ModalFrame>
  );
}

export function PendingRequestModal({
  pendingSamples,
  pendingElicitations,
  inspectorClient,
  width,
  height,
}: PendingRequestModalProps) {
  const total = pendingSamples.length + pendingElicitations.length;
  // A remaining-count hint, shown only when more than the head is queued —
  // the head is always what is displayed, so a "1 of N" would never move.
  const queueLabel = total > 1 ? `${total} pending` : "";

  const sample = pendingSamples[0];
  if (sample) {
    return (
      <SamplingRequest
        key={sample.id}
        sample={sample}
        queueLabel={queueLabel}
        width={width}
        height={height}
      />
    );
  }
  const elicitation = pendingElicitations[0];
  if (!elicitation) return null;
  const params = elicitation.request.params;
  if (params.mode === "url") {
    return (
      <ElicitationUrlRequest
        key={elicitation.id}
        elicitation={elicitation}
        message={params.message}
        url={params.url}
        inspectorClient={inspectorClient}
        queueLabel={queueLabel}
        width={width}
        height={height}
      />
    );
  }
  return (
    <ElicitationFormRequest
      key={elicitation.id}
      elicitation={elicitation}
      params={params}
      inspectorClient={inspectorClient}
      queueLabel={queueLabel}
      width={width}
      height={height}
    />
  );
}
