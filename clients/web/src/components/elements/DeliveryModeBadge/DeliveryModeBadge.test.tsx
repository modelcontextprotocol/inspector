import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { DeliveryModeBadge } from "./DeliveryModeBadge";

describe("DeliveryModeBadge", () => {
  it.each(["poll", "push", "webhook"])("renders the %s mode", (mode) => {
    renderWithMantine(<DeliveryModeBadge mode={mode} />);
    expect(screen.getByText(mode)).toBeInTheDocument();
  });

  it("renders a mode named after an Object member as an unknown one", () => {
    renderWithMantine(<DeliveryModeBadge mode="constructor" />);
    expect(screen.getByText("constructor")).toBeInTheDocument();
  });

  it("still renders a mode this client does not know", () => {
    renderWithMantine(<DeliveryModeBadge mode="carrier-pigeon" />);
    expect(screen.getByText("carrier-pigeon")).toBeInTheDocument();
  });
});
