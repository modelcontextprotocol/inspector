import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { FetchBodyDroppedToastMessage } from "./FetchBodyDroppedToastMessage";
import { OutputValidationToastMessage } from "./OutputValidationToastMessage";
import { UrlElicitationErrorToastMessage } from "./UrlElicitationErrorToastMessage";
import { ToastCauseList, ToastLinkButton } from "./ToastPrimitives";

describe("ToastPrimitives", () => {
  it("renders the shared cause list and link button", () => {
    const onClick = vi.fn();
    renderWithMantine(
      <>
        <ToastCauseList>
          <li>a cause</li>
        </ToastCauseList>
        <ToastLinkButton onClick={onClick}>Do the thing</ToastLinkButton>
      </>,
    );
    expect(screen.getByText("a cause")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Do the thing" }),
    ).toBeInTheDocument();
  });
});

describe("FetchBodyDroppedToastMessage", () => {
  it("names the limit that dropped the body and lists the likely causes", () => {
    renderWithMantine(
      <FetchBodyDroppedToastMessage
        maxFetchRequests={250}
        onAdjust={vi.fn()}
      />,
    );
    expect(screen.getByText(/250/)).toBeInTheDocument();
    expect(
      screen.getByText(/an SSE\/transport reconnect or retry storm/),
    ).toBeInTheDocument();
  });

  it("calls onAdjust from the settings link", async () => {
    const onAdjust = vi.fn();
    renderWithMantine(
      <FetchBodyDroppedToastMessage
        maxFetchRequests={10}
        onAdjust={onAdjust}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Adjust Network Log Size for this server",
      }),
    );
    expect(onAdjust).toHaveBeenCalledTimes(1);
  });
});

describe("OutputValidationToastMessage", () => {
  it("summarizes the mismatch and opens the details modal", async () => {
    const onViewDetails = vi.fn();
    renderWithMantine(
      <OutputValidationToastMessage onViewDetails={onViewDetails} />,
    );
    expect(screen.getByText(/outputSchema/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "View validation details" }),
    );
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });
});

describe("UrlElicitationErrorToastMessage", () => {
  it("explains the empty elicitations list and opens the details modal", async () => {
    const onViewDetails = vi.fn();
    renderWithMantine(
      <UrlElicitationErrorToastMessage onViewDetails={onViewDetails} />,
    );
    expect(
      screen.getByText(/listed no required\s+elicitations/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "View error details" }),
    );
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });
});
