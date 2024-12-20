import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HistoryAndNotifications from "../../components/History";

describe("HistoryAndNotifications", () => {
  const mockHistory = [
    {
      request: JSON.stringify({ method: "test1" }),
      response: JSON.stringify({ result: "output1" }),
    },
    {
      request: JSON.stringify({ method: "test2" }),
      response: JSON.stringify({ result: "output2" }),
    },
  ];

  it("renders history items", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockHistory}
        serverNotifications={[]}
      />,
    );
    const items = screen.getAllByText(/test[12]/, { exact: false });
    expect(items).toHaveLength(2);
  });

  it("expands history item when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockHistory}
        serverNotifications={[]}
      />,
    );

    const firstItem = screen.getByText(/test1/, { exact: false });
    fireEvent.click(firstItem);
    expect(screen.getByText("Request:")).toBeInTheDocument();
    expect(screen.getByText(/output1/, { exact: false })).toBeInTheDocument();
  });

  it("renders and expands server notifications", () => {
    const notifications = [
      { method: "notify1", params: { data: "test data 1" } },
      { method: "notify2", params: { data: "test data 2" } },
    ];
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={notifications}
      />,
    );

    const items = screen.getAllByText(/notify[12]/, { exact: false });
    expect(items).toHaveLength(2);

    fireEvent.click(items[0]);
    expect(screen.getByText("Details:")).toBeInTheDocument();
    expect(screen.getByText(/test data/, { exact: false })).toBeInTheDocument();
  });
});
