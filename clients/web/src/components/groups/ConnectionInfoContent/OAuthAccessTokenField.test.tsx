import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL } from "./ConnectionInfoContent";
import { OAuthAccessTokenField } from "./OAuthAccessTokenField";

const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.";

describe("OAuthAccessTokenField", () => {
  it("renders token with copy control beside the content", () => {
    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);
    expect(screen.getByText("Access Token")).toBeInTheDocument();
    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    expect(screen.getByText(/eyJzdWIiOiJ1c2VyIn0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("replaces raw token with decoded JSON and restores on toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);

    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Decode JWT" }));
    expect(screen.getByText(/"sub": "user"/)).toBeInTheDocument();
    expect(screen.queryByText(/eyJhbGciOiJub25lIn0/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show token" }));
    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    expect(screen.queryByText(/"sub": "user"/)).not.toBeInTheDocument();
  });

  it("omits decode toggle for opaque tokens", () => {
    renderWithMantine(
      <OAuthAccessTokenField accessToken="opaque-access-token-value" />,
    );
    expect(
      screen.queryByRole("button", { name: "Decode JWT" }),
    ).not.toBeInTheDocument();
  });

  it("copies decoded JSON while decode view is shown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);
    await user.click(screen.getByRole("button", { name: "Decode JWT" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"sub": "user"'),
    );
    expect(writeText).not.toHaveBeenCalledWith(jwt);
  });

  it("copies the raw token while token view is shown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(jwt);
  });

  it("renders clear action on the access token header row", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(
      <OAuthAccessTokenField
        accessToken="opaque-access-token-value"
        onClear={onClear}
        clearLabel={CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL,
      }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
