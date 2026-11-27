import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MASKED_WEBHOOK_SECRET } from "@inspector/core/extension/events/webhookSecret.js";
import { WebhookSecretField } from "./WebhookSecretField";

const SECRET = `whsec_${"A".repeat(43)}=`;

describe("WebhookSecretField", () => {
  it("shows the secret masked and never renders its value", () => {
    const { container } = renderWithMantine(
      <WebhookSecretField secret={SECRET} />,
    );
    expect(screen.getByText(MASKED_WEBHOOK_SECRET)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SECRET.slice(6));
    expect(
      screen.getByRole("button", { name: "Copy webhook secret" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Regenerate" }),
    ).not.toBeInTheDocument();
  });

  it("offers a regenerate when given one", async () => {
    const onRegenerate = vi.fn();
    renderWithMantine(
      <WebhookSecretField secret={SECRET} onRegenerate={onRegenerate} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});
