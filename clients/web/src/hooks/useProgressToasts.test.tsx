import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import { renderWithMantine } from "../test/renderWithMantine";
import { progressToastId } from "../utils/toasts/progressToasts";
import { useProgressToasts } from "./useProgressToasts";

// Spy on the toast layer so these assert the show/update calls without
// mounting Mantine's <Notifications/> portal.
const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: {
    show: vi.fn(),
    update: vi.fn(),
    hide: vi.fn(),
    clean: vi.fn(),
  },
}));
vi.mock("@mantine/notifications", () => ({
  notifications: notificationsMock,
}));

/**
 * The client's own typed event target, which is exactly the surface the hook
 * declares — so this is the real wiring under test, not a stand-in: the events
 * dispatched below are the same typed events the client emits.
 */
function fakeClient(): InspectorClientEventTarget {
  return new InspectorClientEventTarget();
}

function harness(client: InspectorClientEventTarget) {
  function Probe({ c }: { c: InspectorClientEventTarget | null }) {
    useProgressToasts(c);
    return null;
  }
  const { rerender, unmount } = renderWithMantine(<Probe c={client} />);
  return {
    progress: (progressToken: string, progress: number, total?: number) =>
      act(() => {
        client.dispatchTypedEvent("progressNotification", {
          progressToken,
          progress,
          total,
        });
      }),
    /** Same as `progress`, but from a client swapped in after mount. */
    progressOn: (
      next: InspectorClientEventTarget,
      progressToken: string,
      progress: number,
    ) =>
      act(() => {
        next.dispatchTypedEvent("progressNotification", {
          progressToken,
          progress,
        });
      }),
    swapClient: (next: InspectorClientEventTarget | null) =>
      act(() => rerender(<Probe c={next} />)),
    unmount: () => act(() => unmount()),
  };
}

describe("useProgressToasts", () => {
  beforeEach(() => {
    notificationsMock.show.mockClear();
    notificationsMock.update.mockClear();
    notificationsMock.hide.mockClear();
  });

  it("does nothing without a client", () => {
    function Probe() {
      useProgressToasts(null);
      return null;
    }
    renderWithMantine(<Probe />);
    expect(notificationsMock.show).not.toHaveBeenCalled();
  });

  it("shows one toast for a stream's first tick", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1, 4);
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    expect(notificationsMock.show.mock.calls[0][0]).toMatchObject({
      id: progressToastId("tok-1"),
      title: "Tool progress",
    });
  });

  it("updates that toast on the next tick rather than stacking a new one", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1, 4);
    h.progress("tok-1", 2, 4);
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    expect(notificationsMock.update).toHaveBeenCalledTimes(1);
    expect(notificationsMock.update.mock.calls[0][0]).toMatchObject({
      id: progressToastId("tok-1"),
    });
  });

  it("gives each stream its own toast", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1);
    h.progress("tok-2", 1);
    expect(notificationsMock.show).toHaveBeenCalledTimes(2);
    expect(notificationsMock.update).not.toHaveBeenCalled();
  });

  it("re-shows a stream whose toast the user closed", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1);
    const { onClose } = notificationsMock.show.mock.calls[0][0] as {
      onClose: () => void;
    };
    onClose();
    h.progress("tok-1", 2);
    expect(notificationsMock.show).toHaveBeenCalledTimes(2);
    expect(notificationsMock.update).not.toHaveBeenCalled();
  });

  it("hides the live toasts when the client is swapped out", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1);
    h.progress("tok-2", 1);
    h.swapClient(null);
    expect(notificationsMock.hide).toHaveBeenCalledWith(
      progressToastId("tok-1"),
    );
    expect(notificationsMock.hide).toHaveBeenCalledWith(
      progressToastId("tok-2"),
    );
  });

  it("stops listening to the old client after a swap", () => {
    const first = fakeClient();
    const h = harness(first);
    h.swapClient(fakeClient());
    notificationsMock.show.mockClear();
    act(() => {
      first.dispatchTypedEvent("progressNotification", {
        progressToken: "tok-1",
        progress: 1,
      });
    });
    expect(notificationsMock.show).not.toHaveBeenCalled();
  });

  it("hides the live toasts on unmount", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1);
    h.unmount();
    expect(notificationsMock.hide).toHaveBeenCalledWith(
      progressToastId("tok-1"),
    );
  });

  // #2219: `hide()` defers `onClose` past the exit transition, so an outgoing
  // toast's callback can fire *after* the new session has re-shown the same id
  // (ids come from the progress token, so a reconnect replays them exactly).
  // The teardown swaps in a fresh Set rather than clearing the shared one, so
  // that late callback must not touch the new session's bookkeeping. No timers
  // needed: calling the captured `onClose` by hand is exactly that late fire.
  it("keeps the new session's bookkeeping when a hidden toast's onClose fires late", () => {
    const h = harness(fakeClient());
    h.progress("tok-1", 1);
    const { onClose: staleOnClose } = notificationsMock.show.mock
      .calls[0][0] as { onClose: () => void };

    const next = fakeClient();
    h.swapClient(next);
    h.progressOn(next, "tok-1", 1);
    expect(notificationsMock.show).toHaveBeenCalledTimes(2);

    // The outgoing session's toast finishes its exit transition here.
    staleOnClose();

    h.progressOn(next, "tok-1", 2);
    expect(notificationsMock.show).toHaveBeenCalledTimes(2);
    expect(notificationsMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: progressToastId("tok-1") }),
    );
  });
});
