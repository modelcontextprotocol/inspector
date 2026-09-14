import { Alert, CloseButton, Group, Modal, Stack, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElicitResult } from "@modelcontextprotocol/client";
import type { AppElicitationEntry } from "../../../lib/appElicitationController";
import {
  AppRenderer,
  type AppRenderSource,
  type AppRendererHandle,
  type AppRendererStatus,
  type BridgeFactory,
} from "../AppRenderer/AppRenderer";

/**
 * How long an app has to complete `ui/initialize` before the host gives up and
 * lets the native elicitation UI take the request.
 *
 * Short on purpose, and unrelated to {@link APP_ELICITATION_TIMEOUT_MS} (which
 * bounds the *answer*): nothing here waits on a human, so a sandbox that has
 * not handshaken in this window is broken rather than slow, and the user is
 * better served by the native form than by a spinner.
 */
export const APP_ELICITATION_INIT_TIMEOUT_MS = 15_000;

/**
 * Modal shell for one app-rendered elicitation.
 *
 * Deliberately headerless (`withCloseButton: false`, no `title`): concurrent
 * elicitations mean two of these are open at once, and Mantine's modal header
 * is a `<header>` — a second banner landmark, which axe flags as both
 * `landmark-no-duplicate-banner` and `landmark-unique`. The title and the close
 * affordance live in the body instead, and each dialog is named by its own
 * `aria-label` so the two remain distinguishable.
 */
const ElicitationModal = Modal.Root.withProps({
  centered: true,
  size: "lg",
  closeOnClickOutside: false,
});

const ElicitationOverlay = Modal.Overlay.withProps({
  backgroundOpacity: 0.55,
  blur: 2,
});

/** Title row: the server's prompt plus the dismiss control. */
const TitleRow = Group.withProps({
  justify: "space-between",
  align: "flex-start",
  wrap: "nowrap",
  gap: "sm",
});

const TitleText = Text.withProps({
  fw: 600,
  size: "md",
});

/** Fixed-height frame the app renders into; apps size themselves within it. */
const FrameBox = Stack.withProps({
  h: 360,
  gap: 0,
});

const PromptText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export interface AppElicitationHostProps {
  /** Elicitations currently awaiting an app answer, oldest first. */
  entries: AppElicitationEntry[];
  /**
   * The inspector's sandbox-proxy URL. Absent means the sandbox controller is
   * not running, so nothing can be rendered — every entry falls back at once.
   */
  sandboxPath?: string;
  /** Builds the per-app bridge. Must advertise `hostCapabilities.elicitation`. */
  bridgeFactory: BridgeFactory;
  /** The app answered: hand the standard result back to the server. */
  onSettle: (requestId: string, result: ElicitResult) => void;
  /** The app could not answer: fall back to the native elicitation UI. */
  onFail: (requestId: string, error: Error) => void;
}

/**
 * Renders every pending app-rendered elicitation (#1854), one modal and one
 * bridge per request.
 *
 * Keyed by `requestId` rather than by resource URI so that two concurrent
 * requests — even for the SAME app — get distinct React subtrees, distinct
 * iframes and distinct bridges. That is what makes the ownership request-scoped
 * in practice, not just on paper.
 */
export function AppElicitationHost({
  entries,
  sandboxPath,
  bridgeFactory,
  onSettle,
  onFail,
}: AppElicitationHostProps) {
  // No sandbox → nothing can render. Fail every entry immediately rather than
  // showing an empty modal the user cannot act on.
  useEffect(() => {
    if (sandboxPath) return;
    for (const entry of entries) {
      onFail(
        entry.requestId,
        new Error("MCP App sandbox is not available in this session"),
      );
    }
  }, [entries, sandboxPath, onFail]);

  if (!sandboxPath) return null;

  return (
    <>
      {entries.map((entry, index) => (
        <AppElicitationFrame
          key={entry.requestId}
          entry={entry}
          // Only the last-rendered modal is on top, so only it may own the
          // focus trap, the Escape key and the overlay — see the prop's doc.
          isTop={index === entries.length - 1}
          sandboxPath={sandboxPath}
          bridgeFactory={bridgeFactory}
          onSettle={onSettle}
          onFail={onFail}
        />
      ))}
    </>
  );
}

interface AppElicitationFrameProps {
  entry: AppElicitationEntry;
  /**
   * Whether this modal is the topmost of the open set.
   *
   * Concurrent elicitations mean several are open at once, and each would
   * otherwise install its own focus trap, Escape handler and overlay — which
   * fight over the keyboard and let one Escape dismiss more than one pending
   * request. Only the top one owns those; the rest stay mounted (their apps
   * keep their bridges and their handshakes) but inert to the keyboard.
   */
  isTop: boolean;
  sandboxPath: string;
  bridgeFactory: BridgeFactory;
  onSettle: (requestId: string, result: ElicitResult) => void;
  onFail: (requestId: string, error: Error) => void;
}

/**
 * One request: mount the app, and the moment its view reports `ready`, forward
 * the original `elicitation/create` through THAT app's bridge.
 *
 * Every failure route ends in `onFail`, which is the fallback signal — an
 * unreachable sandbox, a view that never handshakes, an app with no elicitation
 * capability, a bridge error, or the user dismissing the modal.
 */
function AppElicitationFrame({
  entry,
  isTop,
  sandboxPath,
  bridgeFactory,
  onSettle,
  onFail,
}: AppElicitationFrameProps) {
  const rendererRef = useRef<AppRendererHandle>(null);
  // Guards the one-shot send: `ready` can fire again after a bridge rebuild,
  // and a second `elicitation/create` for the same server request would be a
  // duplicate the server never asked for.
  const sentRef = useRef(false);
  const [status, setStatus] = useState<AppRendererStatus>("loading");

  const source = useMemo<AppRenderSource>(
    () => ({
      kind: "resource",
      resourceUri: entry.resourceUri,
      title: entry.params.message,
    }),
    [entry.resourceUri, entry.params.message],
  );

  const fail = useCallback(
    (error: Error) => {
      onFail(entry.requestId, error);
    },
    [entry.requestId, onFail],
  );

  // Dismissing is not an answer: the server is still waiting, so hand the
  // request to the native elicitation UI rather than inventing a `cancel`.
  const dismiss = useCallback(
    () => fail(new Error("App-rendered elicitation dismissed")),
    [fail],
  );

  // Initialization deadline. Cleared as soon as the request goes out, so it
  // only ever bounds the handshake and never the user's answer.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (sentRef.current) return;
      fail(new Error("MCP App did not initialize in time"));
    }, APP_ELICITATION_INIT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [fail]);

  const handleStatus = useCallback(
    (next: AppRendererStatus) => {
      setStatus(next);
      if (next === "error") {
        fail(new Error("MCP App failed to render"));
        return;
      }
      if (next !== "ready" || sentRef.current) return;
      sentRef.current = true;
      const handle = rendererRef.current;
      /* v8 ignore next 4 -- defensive: `ready` is dispatched from the renderer's
         own bridge callback, so its imperative handle is always attached by the
         time this runs. */
      if (!handle) {
        fail(new Error("MCP App renderer is unavailable"));
        return;
      }
      handle
        .requestElicitation(entry.params)
        .then((result) => onSettle(entry.requestId, result))
        .catch((err: unknown) => fail(toError(err)));
    },
    [entry.params, entry.requestId, fail, onSettle],
  );

  return (
    <ElicitationModal
      // `opened` stays at the call site: it is REQUIRED by `ModalRootProps`,
      // and `.withProps()` supplies defaults without relaxing a required prop,
      // so baking it in leaves every call site failing TS2741.
      opened
      onClose={dismiss}
      trapFocus={isTop}
      closeOnEscape={isTop}
    >
      {isTop && <ElicitationOverlay />}
      {/* `aria-label` and the `data-*` attributes go on the CONTENT (the
          role="dialog" element), not the Root — the Root is only a portal
          wrapper, so a name placed there never reaches the dialog. Named per
          request rather than per prompt or per app: two concurrent
          elicitations can be for the SAME app URI with the SAME message, and
          only the request id tells those two dialogs apart — for
          `landmark-unique` and for anyone navigating by screen reader. */}
      <Modal.Content
        // A lower dialog is visually covered but would otherwise stay an
        // exposed `aria-modal` dialog with reachable controls and an iframe —
        // so browse navigation could land in a dialog that itself claims the
        // rest of the page is inert. `inert` takes it out of the a11y tree and
        // out of focus order WITHOUT unmounting, so its app keeps its bridge
        // and its handshake and is live the moment it becomes top.
        inert={!isTop}
        aria-label={`Elicitation ${entry.requestId} — ${entry.params.message} — rendered by ${entry.resourceUri}`}
        data-app-elicitation-status={status}
        data-testid="app-elicitation"
      >
        <Modal.Body>
          <Stack gap="xs">
            <TitleRow>
              <TitleText>{entry.params.message}</TitleText>
              <CloseButton
                onClick={dismiss}
                aria-label="Close and use the built-in elicitation form"
              />
            </TitleRow>
            <PromptText>
              Answering through the server-provided MCP App.
            </PromptText>
            {status === "error" ? (
              <Alert color="red" title="App failed to render">
                Falling back to the built-in elicitation form.
              </Alert>
            ) : (
              <FrameBox>
                <AppRenderer
                  ref={rendererRef}
                  sandboxPath={sandboxPath}
                  source={source}
                  bridgeFactory={bridgeFactory}
                  onAppStatusChange={handleStatus}
                  onError={fail}
                />
              </FrameBox>
            )}
          </Stack>
        </Modal.Body>
      </Modal.Content>
    </ElicitationModal>
  );
}
