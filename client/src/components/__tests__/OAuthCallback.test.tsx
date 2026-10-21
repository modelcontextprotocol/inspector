import { render, waitFor } from "@testing-library/react";
import OAuthCallback from "../OAuthCallback";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { SESSION_KEYS } from "../../lib/constants";
import {
  OAuthConnectionSnapshot,
  readOAuthConnectionSnapshot,
  saveOAuthConnectionSnapshot,
} from "../../lib/oauthConnectionSnapshot";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
}));

jest.mock("../../lib/auth", () => ({
  InspectorOAuthClientProvider: jest.fn(),
}));

const mockToast = jest.fn();
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockAuth = jest.mocked(auth);

const SNAPSHOT: OAuthConnectionSnapshot = {
  serverUrl: "https://remote.example/mcp",
  transportType: "streamable-http",
  connectionType: "proxy",
  command: "",
  args: "",
  proxyAddress: "http://localhost:6277",
};

describe("OAuthCallback", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    saveOAuthConnectionSnapshot(SNAPSHOT);
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, SNAPSHOT.serverUrl);
    mockAuth.mockResolvedValue("AUTHORIZED");
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const renderAt = async (
    query: string,
    onConnect: jest.Mock = jest.fn(() => undefined),
  ) => {
    window.history.replaceState({}, "", `/oauth/callback${query}`);
    render(<OAuthCallback onConnect={onConnect} />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    return onConnect;
  };

  const errorToasts = () =>
    mockToast.mock.calls.filter(([t]) => t.variant === "destructive");

  test("clears the snapshot after a successful reconnect", async () => {
    const onConnect = await renderAt("?code=abc&state=xyz");
    expect(onConnect).toHaveBeenCalledWith(SNAPSHOT.serverUrl);
    expect(errorToasts()).toHaveLength(0);
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("shows the refusal when onConnect declines", async () => {
    await renderAt(
      "?code=abc&state=xyz",
      jest.fn(() => "Not reconnecting."),
    );
    expect(errorToasts()[0][0].description).toBe("Not reconnecting.");
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("clears the snapshot when the authorization server returns an error", async () => {
    const onConnect = await renderAt("?error=access_denied");
    expect(onConnect).not.toHaveBeenCalled();
    expect(errorToasts()).toHaveLength(1);
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("clears the snapshot when the server URL is missing", async () => {
    sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
    const onConnect = await renderAt("?code=abc&state=xyz");
    expect(onConnect).not.toHaveBeenCalled();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("clears the snapshot when the code exchange throws", async () => {
    mockAuth.mockRejectedValue(new Error("exchange failed"));
    const onConnect = await renderAt("?code=abc&state=xyz");
    expect(onConnect).not.toHaveBeenCalled();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("clears the snapshot when the code exchange does not authorize", async () => {
    mockAuth.mockResolvedValue("REDIRECT");
    const onConnect = await renderAt("?code=abc&state=xyz");
    expect(onConnect).not.toHaveBeenCalled();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });
});
