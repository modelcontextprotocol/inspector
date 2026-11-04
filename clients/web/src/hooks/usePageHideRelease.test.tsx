import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  releaseOnPageHide,
  usePageHideRelease,
  type PageHideReleasable,
} from "./usePageHideRelease";
import {
  readOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "../lib/oauthResume";

vi.mock("../lib/oauthResume", () => ({
  readOAuthResumeSnapshot: vi.fn(),
}));

const readSnapshot = vi.mocked(readOAuthResumeSnapshot);

function fakeClient(sessionId: string | undefined) {
  return {
    getRemoteBackendSessionId: vi.fn(() => sessionId),
    releaseRemoteSessionOnPageHide: vi.fn(() => true),
  } satisfies PageHideReleasable;
}

/** A `pagehide` the way the browser delivers one. */
function pageHide(persisted: boolean): Event {
  return Object.assign(new Event("pagehide"), { persisted });
}

/** A resume snapshot; only `remoteSessionId` matters to this hook. */
function snapshotFor(remoteSessionId: string | undefined): OAuthResumeSnapshot {
  return {
    version: 1,
    serverId: "srv",
    activeTab: "tools",
    authKind: "reauth",
    tabUi: {},
    ...(remoteSessionId && { remoteSessionId }),
  };
}

function Probe({ client }: { client: PageHideReleasable | null }) {
  usePageHideRelease(client);
  return null;
}

beforeEach(() => {
  readSnapshot.mockReset();
  readSnapshot.mockReturnValue(undefined);
});

describe("releaseOnPageHide (#2824)", () => {
  it("releases the session when the page is really going away", () => {
    const client = fakeClient("sess-1");
    expect(releaseOnPageHide(client, { persisted: false })).toBe(true);
    expect(client.releaseRemoteSessionOnPageHide).toHaveBeenCalledTimes(1);
  });

  it("keeps the session for a page entering the back/forward cache", () => {
    const client = fakeClient("sess-1");
    expect(releaseOnPageHide(client, { persisted: true })).toBe(false);
    expect(client.releaseRemoteSessionOnPageHide).not.toHaveBeenCalled();
  });

  it("does nothing without a backend session", () => {
    const client = fakeClient(undefined);
    expect(releaseOnPageHide(client, { persisted: false })).toBe(false);
    expect(client.releaseRemoteSessionOnPageHide).not.toHaveBeenCalled();
  });

  it("keeps the session an OAuth redirect will reattach to", () => {
    readSnapshot.mockReturnValue(snapshotFor("sess-1"));
    const client = fakeClient("sess-1");
    expect(releaseOnPageHide(client, { persisted: false })).toBe(false);
    expect(client.releaseRemoteSessionOnPageHide).not.toHaveBeenCalled();
  });

  it("still releases when the pending snapshot names a different session", () => {
    readSnapshot.mockReturnValue(snapshotFor("sess-other"));
    const client = fakeClient("sess-1");
    expect(releaseOnPageHide(client, { persisted: false })).toBe(true);
  });
});

describe("usePageHideRelease (#2824)", () => {
  it("releases on pagehide and stops listening on unmount", () => {
    const client = fakeClient("sess-1");
    const { unmount } = renderWithMantine(<Probe client={client} />);

    window.dispatchEvent(pageHide(false));
    expect(client.releaseRemoteSessionOnPageHide).toHaveBeenCalledTimes(1);

    unmount();
    window.dispatchEvent(pageHide(false));
    expect(client.releaseRemoteSessionOnPageHide).toHaveBeenCalledTimes(1);
  });

  it("registers nothing while there is no client", () => {
    const add = vi.spyOn(window, "addEventListener");
    renderWithMantine(<Probe client={null} />);
    expect(add.mock.calls.some(([type]) => type === "pagehide")).toBe(false);
    add.mockRestore();
  });
});
