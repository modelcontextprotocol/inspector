import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { OAuthAccessTokenField } from "./OAuthAccessTokenField";

const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.";

describe("OAuthAccessTokenField", () => {
  it("renders token with copy control beside the label", () => {
    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);
    expect(screen.getByText("Access Token")).toBeInTheDocument();
    expect(screen.getByText("eyJhbGciOiJub25lIn0")).toBeInTheDocument();
    expect(screen.getByText("eyJzdWIiOiJ1c2VyIn0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("replaces raw token with decoded JSON and restores on toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(<OAuthAccessTokenField accessToken={jwt} />);

    expect(screen.getByText("eyJhbGciOiJub25lIn0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Decode JWT" }));
    expect(screen.getByText(/"sub": "user"/)).toBeInTheDocument();
    expect(screen.queryByText("eyJhbGciOiJub25lIn0")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show token" }));
    expect(screen.getByText("eyJhbGciOiJub25lIn0")).toBeInTheDocument();
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
});
