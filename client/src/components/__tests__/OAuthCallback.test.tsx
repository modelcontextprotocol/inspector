import { render, waitFor } from "@testing-library/react";
import OAuthCallback from "../OAuthCallback";
import { SESSION_KEYS, getServerSpecificKey } from "../../lib/constants";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
  discoverAuthorizationServerMetadata: jest.fn(),
}));

const mockToast = jest.fn();
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockAuth = auth as jest.MockedFunction<typeof auth>;

const SERVER_URL = "https://example.com/mcp";
const STORED_STATE = "a".repeat(64);

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/oauth/callback${search}`);
};

const errorDescriptions = () =>
  mockToast.mock.calls
    .filter(([arg]) => arg?.variant === "destructive")
    .map(([arg]) => String(arg.description));

describe("OAuthCallback state validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockAuth.mockResolvedValue("AUTHORIZED");
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, SERVER_URL);
  });

  const storeExpectedState = (state: string) =>
    sessionStorage.setItem(
      getServerSpecificKey(SESSION_KEYS.OAUTH_STATE, SERVER_URL),
      state,
    );

  it("exchanges the code when the returned state matches the stored one", async () => {
    storeExpectedState(STORED_STATE);
    setSearch(`?code=abc123&state=${STORED_STATE}`);
    const onConnect = jest.fn();

    render(<OAuthCallback onConnect={onConnect} />);

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(SERVER_URL));
    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(errorDescriptions()).toHaveLength(0);
  });

  it("consumes the stored state so a replayed callback cannot reuse it", async () => {
    storeExpectedState(STORED_STATE);
    setSearch(`?code=abc123&state=${STORED_STATE}`);

    render(<OAuthCallback onConnect={jest.fn()} />);

    await waitFor(() =>
      expect(
        sessionStorage.getItem(
          getServerSpecificKey(SESSION_KEYS.OAUTH_STATE, SERVER_URL),
        ),
      ).toBeNull(),
    );
  });

  it.each([
    {
      name: "the returned state does not match",
      stored: STORED_STATE,
      search: `?code=abc123&state=${"b".repeat(64)}`,
    },
    {
      name: "the callback carries no state",
      stored: STORED_STATE,
      search: "?code=abc123",
    },
    {
      name: "this session never started an authorization request",
      stored: undefined,
      search: `?code=abc123&state=${STORED_STATE}`,
    },
  ])("rejects the callback when $name", async ({ stored, search }) => {
    if (stored) storeExpectedState(stored);
    setSearch(search);
    const onConnect = jest.fn();

    render(<OAuthCallback onConnect={onConnect} />);

    await waitFor(() =>
      expect(errorDescriptions().join("\n")).toContain(
        "Invalid OAuth state parameter",
      ),
    );
    expect(mockAuth).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });
});
