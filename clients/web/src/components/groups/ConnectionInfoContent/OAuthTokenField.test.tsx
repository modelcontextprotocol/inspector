import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL } from "./ConnectionInfoContent";
import { OAuthTokenField } from "./OAuthTokenField";

const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.";

describe("OAuthTokenField", () => {
  it("renders token with copy control beside the content", () => {
    renderWithMantine(<OAuthTokenField label="Access Token" token={jwt} />);
    expect(screen.getByText("Access Token")).toBeInTheDocument();
    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    expect(screen.getByText(/eyJzdWIiOiJ1c2VyIn0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Access Token" }),
    ).toBeInTheDocument();
  });

  it("replaces raw token with decoded JSON and restores on toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(<OAuthTokenField label="Access Token" token={jwt} />);

    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Decode JWT for Access Token" }),
    );
    expect(screen.getByText(/"sub": "user"/)).toBeInTheDocument();
    expect(screen.queryByText(/eyJhbGciOiJub25lIn0/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show token for Access Token" }),
    );
    expect(screen.getByText(/eyJhbGciOiJub25lIn0/)).toBeInTheDocument();
    expect(screen.queryByText(/"sub": "user"/)).not.toBeInTheDocument();
  });

  it("omits decode toggle for opaque tokens", () => {
    renderWithMantine(
      <OAuthTokenField
        label="Access Token"
        token="opaque-access-token-value"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Decode JWT for Access Token" }),
    ).not.toBeInTheDocument();
  });

  it("copies decoded JSON while decode view is shown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithMantine(<OAuthTokenField label="Access Token" token={jwt} />);
    await user.click(
      screen.getByRole("button", { name: "Decode JWT for Access Token" }),
    );
    await user.click(screen.getByRole("button", { name: "Copy Access Token" }));

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

    renderWithMantine(<OAuthTokenField label="Access Token" token={jwt} />);
    await user.click(screen.getByRole("button", { name: "Copy Access Token" }));

    expect(writeText).toHaveBeenCalledWith(jwt);
  });

  it("renders clear action on the access token header row", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(
      <OAuthTokenField
        label="Access Token"
        token="opaque-access-token-value"
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

  it("labels the row from the label prop and decodes an ID token", async () => {
    const user = userEvent.setup();
    // header {"alg":"none"} / payload {"sub":"user"} — same shape an AS returns
    // for an `id_token`; the decode path is identical to the access token's.
    renderWithMantine(<OAuthTokenField label="ID Token" token={jwt} />);

    expect(screen.getByText("ID Token")).toBeInTheDocument();
    expect(screen.queryByText("Access Token")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Decode JWT for ID Token" }),
    );
    expect(screen.getByText(/"sub": "user"/)).toBeInTheDocument();
  });

  it("qualifies the decode and copy accessible names with the row label", () => {
    // Two rows can render simultaneously (Access Token + ID Token), so the
    // controls must not share accessible names — see #2019 review.
    renderWithMantine(<OAuthTokenField label="ID Token" token={jwt} />);

    expect(
      screen.getByRole("button", { name: "Decode JWT for ID Token" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy ID Token" }),
    ).toBeInTheDocument();
  });

  it("omits the clear action when no handler is given", () => {
    renderWithMantine(<OAuthTokenField label="ID Token" token={jwt} />);
    expect(
      screen.queryByRole("button", {
        name: CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL,
      }),
    ).not.toBeInTheDocument();
  });
});
