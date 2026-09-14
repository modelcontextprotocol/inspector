import { useEffect, useRef } from "react";
import { notifications } from "@mantine/notifications";
import type { InspectorClientEventMap } from "@inspector/core/mcp/index.js";
import type { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import {
  formatProgressToastMessage,
  PROGRESS_TOAST_AUTOCLOSE_MS,
  progressToastId,
} from "../utils/toasts/progressToasts";

/**
 * The only part of the client the toast hooks touch: its typed event-listener
 * surface. Naming that rather than the whole `InspectorClient` states the real
 * dependency, and lets a test drive them with a plain
 * `InspectorClientEventTarget` instead of a stand-in cast to a full client.
 *
 * Declared here (rather than in a module of its own) because it has no runtime
 * half, and `useTaskToasts` — its only other consumer — is a sibling.
 */
export type InspectorClientEventSource = Pick<
  InspectorClientEventTarget,
  "addEventListener" | "removeEventListener"
>;

/**
 * Surface incoming `notifications/progress` as toasts so the user can watch a
 * long-running tool's progress while staying on the tool view — the v2
 * replacement for v1's always-visible "Server Notifications" shelf (#1414).
 *
 * The full notification history still lives in the Protocol tab; these toasts
 * are the at-a-glance, in-context signal. Toasts are keyed by progress stream
 * (see `progressToastId`) and replaced per tick, so a chatty server updates one
 * toast rather than stacking one per tick.
 *
 * Returns nothing — the recorded exception to #2128's "each hook returns one
 * object" criterion, which exists to stop a hook handing back a long list of
 * loose values (`useTabUiState`'s twenty-two is the case it was written
 * against). This hook subscribes, shows toasts and unsubscribes; the only
 * state it owns is toast-id bookkeeping the caller must not see. An empty
 * object would advertise an API that is not there.
 */
export function useProgressToasts(
  inspectorClient: InspectorClientEventSource | null,
) {
  // Which progress streams currently have a live toast. Entries are removed
  // when their toast closes (auto-dismiss or user). A ref (not state) because
  // it is incidental bookkeeping that must not trigger re-renders.
  const progressToastIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!inspectorClient) return;
    const liveToastIds = progressToastIdsRef.current;
    const onProgress = (
      event: TypedEventGeneric<InspectorClientEventMap, "progressNotification">,
    ) => {
      const detail = event.detail;
      const id = progressToastId(detail.progressToken);
      const message = formatProgressToastMessage(detail);
      if (liveToastIds.has(id)) {
        notifications.update({
          id,
          title: "Tool progress",
          message,
          color: "blue",
          autoClose: PROGRESS_TOAST_AUTOCLOSE_MS,
        });
        return;
      }
      liveToastIds.add(id);
      notifications.show({
        id,
        title: "Tool progress",
        message,
        color: "blue",
        autoClose: PROGRESS_TOAST_AUTOCLOSE_MS,
        onClose: () => liveToastIds.delete(id),
      });
    };
    inspectorClient.addEventListener("progressNotification", onProgress);
    return () => {
      inspectorClient.removeEventListener("progressNotification", onProgress);
      // Dismiss any still-visible progress toasts when the client is swapped
      // out, then drop the stream bookkeeping. Hiding them (rather than letting
      // them auto-close up to PROGRESS_TOAST_AUTOCLOSE_MS later) keeps a stale
      // "Tool progress" toast from lingering into the next session, and avoids
      // a race where the lingering toast's `onClose` would later delete an id
      // from the *new* session's set and trigger a duplicate-id re-show.
      //
      // The bookkeeping is dropped by **swapping in a fresh Set**, not by
      // calling `liveToastIds.clear()` — the distinction is load-bearing and
      // invisible otherwise (#2219). `hide()` does not fire `onClose`
      // synchronously; it plays the toast's exit transition first. Every
      // outgoing toast's `onClose` closes over *this* Set object, so clearing
      // it in place would leave those callbacks pointed at the very container
      // the next session refills — and a delayed `onClose` for an id the new
      // session has already re-shown (both hooks derive ids from data, so a
      // reconnect replays them exactly) would delete the new entry. The stream
      // would then take the `show` branch instead of `update`, Mantine would
      // refuse the duplicate id, and the toast would freeze mid-progress.
      // Reassigning detaches the outgoing session's callbacks onto a Set
      // nothing reads again.
      liveToastIds.forEach((id) => notifications.hide(id));
      progressToastIdsRef.current = new Set();
    };
  }, [inspectorClient]);
}
