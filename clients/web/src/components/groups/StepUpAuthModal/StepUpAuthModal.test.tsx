import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { StepUpAuthModal } from "./StepUpAuthModal";

const stepUpChallenge: AuthChallenge = {
  reason: "insufficient_scope",
  requiredScopes: ["weather:read"],
  authorizationScopes: ["mcp", "tools:read", "weather:read"],
  context: { toolName: "get_temp" },
};

describe("StepUpAuthModal", () => {
  it("does not render when closed", () => {
    renderWithMantine(
      <StepUpAuthModal
        opened={false}
        challenge={stepUpChallenge}
        onAuthorize={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/Additional permissions required/i),
    ).not.toBeInTheDocument();
  });

  it("lists additional scopes from the challenge, not the SEP-2350 union", () => {
    renderWithMantine(
      <StepUpAuthModal
        opened
        challenge={stepUpChallenge}
        authorizationScopes={stepUpChallenge.authorizationScopes}
        onAuthorize={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Additional permissions required/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/get_temp/)).toBeInTheDocument();
    expect(screen.getByText("weather:read")).toBeInTheDocument();
    expect(screen.queryByText("tools:read")).not.toBeInTheDocument();
    expect(screen.queryByText("mcp")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /redirected to authorize, then returned to the inspector/i,
      ),
    ).toBeInTheDocument();
  });

  it("uses EMA copy when enterpriseManaged is true", () => {
    renderWithMantine(
      <StepUpAuthModal
        opened
        enterpriseManaged
        challenge={stepUpChallenge}
        onAuthorize={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Additional organization permissions required/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/enterprise identity provider/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /redirected to authorize, then returned to the inspector/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("falls back to requiredScopes when authorizationScopes is empty", () => {
    renderWithMantine(
      <StepUpAuthModal
        opened
        challenge={{
          reason: "insufficient_scope",
          requiredScopes: ["admin:write"],
        }}
        onAuthorize={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("admin:write")).toBeInTheDocument();
  });

  it("calls onAuthorize when Authorize is clicked", async () => {
    const user = userEvent.setup();
    const onAuthorize = vi.fn();
    renderWithMantine(
      <StepUpAuthModal
        opened
        challenge={stepUpChallenge}
        onAuthorize={onAuthorize}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Authorize$/ }));
    expect(onAuthorize).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <StepUpAuthModal
        opened
        challenge={stepUpChallenge}
        onAuthorize={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
