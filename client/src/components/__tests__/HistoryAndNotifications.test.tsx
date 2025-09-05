import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, jest } from "@jest/globals";
import HistoryAndNotifications from "../HistoryAndNotifications";
import { ServerNotification } from "@modelcontextprotocol/sdk/types.js";

// Mock JsonView component
jest.mock("../JsonView", () => {
  return function JsonView({ data }: { data: string }) {
    return <div data-testid="json-view">{data}</div>;
  };
});

describe("HistoryAndNotifications", () => {
  const mockRequestHistory = [
    {
      request: JSON.stringify({ method: "test/method1", params: {} }),
      response: JSON.stringify({ result: "success" }),
    },
    {
      request: JSON.stringify({ method: "test/method2", params: {} }),
      response: JSON.stringify({ result: "success" }),
    },
  ];

  const mockNotifications: ServerNotification[] = [
    {
      method: "notifications/message",
      params: {
        level: "info" as const,
        message: "First notification",
      },
    },
    {
      method: "notifications/progress",
      params: {
        progressToken: "test-token",
        progress: 50,
        message: "Second notification",
      },
    },
  ];

  it("renders history and notifications sections", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={mockNotifications}
      />,
    );

    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.getByText("Server Notifications")).toBeTruthy();
  });

  it("displays request history items with correct numbering", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    // Items should be numbered in reverse order (newest first)
    expect(screen.getByText("2. test/method2")).toBeTruthy();
    expect(screen.getByText("1. test/method1")).toBeTruthy();
  });

  it("displays server notifications with correct numbering", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    // Items should be numbered in reverse order (newest first)
    expect(screen.getByText("2. notifications/progress")).toBeTruthy();
    expect(screen.getByText("1. notifications/message")).toBeTruthy();
  });

  it("expands and collapses request items when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    const firstRequestHeader = screen.getByText("2. test/method2");

    // Initially collapsed - should show ▶ arrows (there are multiple)
    expect(screen.getAllByText("▶")).toHaveLength(2);
    expect(screen.queryByText("Request:")).toBeNull();

    // Click to expand
    fireEvent.click(firstRequestHeader);

    // Should now be expanded - one ▼ and one ▶
    expect(screen.getByText("▼")).toBeTruthy();
    expect(screen.getAllByText("▶")).toHaveLength(1);
    expect(screen.getByText("Request:")).toBeTruthy();
    expect(screen.getByText("Response:")).toBeTruthy();
  });

  it("expands and collapses notification items when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    const firstNotificationHeader = screen.getByText(
      "2. notifications/progress",
    );

    // Initially collapsed
    expect(screen.getAllByText("▶")).toHaveLength(2);
    expect(screen.queryByText("Details:")).toBeNull();

    // Click to expand
    fireEvent.click(firstNotificationHeader);

    // Should now be expanded
    expect(screen.getByText("▼")).toBeTruthy();
    expect(screen.getAllByText("▶")).toHaveLength(1);
    expect(screen.getByText("Details:")).toBeTruthy();
  });

  it("maintains expanded state when new notifications are added", () => {
    const { rerender } = render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    // Find and expand the older notification (should be "1. notifications/message")
    const olderNotificationHeader = screen.getByText(
      "1. notifications/message",
    );
    fireEvent.click(olderNotificationHeader);

    // Verify it's expanded
    expect(screen.getByText("Details:")).toBeTruthy();

    // Add a new notification at the beginning (simulating real behavior)
    const newNotifications: ServerNotification[] = [
      {
        method: "notifications/resources/updated",
        params: { uri: "file://test.txt" },
      },
      ...mockNotifications,
    ];

    // Re-render with new notifications
    rerender(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={newNotifications}
      />,
    );

    // The original notification should still be expanded
    // It's now numbered as "2. notifications/message" due to the new item
    expect(screen.getByText("3. notifications/progress")).toBeTruthy();
    expect(screen.getByText("2. notifications/message")).toBeTruthy();
    expect(screen.getByText("1. notifications/resources/updated")).toBeTruthy();

    // The originally expanded notification should still show its details
    expect(screen.getByText("Details:")).toBeTruthy();
  });

  it("maintains expanded state when new requests are added", () => {
    const { rerender } = render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    // Find and expand the older request (should be "1. test/method1")
    const olderRequestHeader = screen.getByText("1. test/method1");
    fireEvent.click(olderRequestHeader);

    // Verify it's expanded
    expect(screen.getByText("Request:")).toBeTruthy();
    expect(screen.getByText("Response:")).toBeTruthy();

    // Add a new request at the beginning
    const newRequestHistory = [
      {
        request: JSON.stringify({ method: "test/new_method", params: {} }),
        response: JSON.stringify({ result: "new success" }),
      },
      ...mockRequestHistory,
    ];

    // Re-render with new request history
    rerender(
      <HistoryAndNotifications
        requestHistory={newRequestHistory}
        serverNotifications={[]}
      />,
    );

    // The original request should still be expanded
    // It's now numbered as "2. test/method1" due to the new item
    expect(screen.getByText("3. test/method2")).toBeTruthy();
    expect(screen.getByText("2. test/method1")).toBeTruthy();
    expect(screen.getByText("1. test/new_method")).toBeTruthy();

    // The originally expanded request should still show its details
    expect(screen.getByText("Request:")).toBeTruthy();
    expect(screen.getByText("Response:")).toBeTruthy();
  });

  it("displays empty state messages when no data is available", () => {
    render(
      <HistoryAndNotifications requestHistory={[]} serverNotifications={[]} />,
    );

    expect(screen.getByText("No history yet")).toBeTruthy();
    expect(screen.getByText("No notifications yet")).toBeTruthy();
  });

  it("clears request history when Clear is clicked", () => {
    const Wrapper = () => {
      const [history, setHistory] = useState(mockRequestHistory);
      return (
        <HistoryAndNotifications
          requestHistory={history}
          serverNotifications={[]}
          onClearHistory={() => setHistory([])}
        />
      );
    };

    render(<Wrapper />);

    // Verify items are present initially
    expect(screen.getByText("2. test/method2")).toBeTruthy();
    expect(screen.getByText("1. test/method1")).toBeTruthy();

    // Click Clear in History header (scoped by the History heading's container)
    const historyHeader = screen.getByText("History");
    const historyHeaderContainer = historyHeader.parentElement as HTMLElement;
    const historyClearButton = within(historyHeaderContainer).getByRole(
      "button",
      { name: "Clear" },
    );
    fireEvent.click(historyClearButton);

    // History should now be empty
    expect(screen.getByText("No history yet")).toBeTruthy();
  });

  it("clears server notifications when Clear is clicked", () => {
    const Wrapper = () => {
      const [notifications, setNotifications] =
        useState<ServerNotification[]>(mockNotifications);
      return (
        <HistoryAndNotifications
          requestHistory={[]}
          serverNotifications={notifications}
          onClearNotifications={() => setNotifications([])}
        />
      );
    };

    render(<Wrapper />);

    // Verify items are present initially
    expect(screen.getByText("2. notifications/progress")).toBeTruthy();
    expect(screen.getByText("1. notifications/message")).toBeTruthy();

    // Click Clear in Server Notifications header (scoped by its heading's container)
    const notifHeader = screen.getByText("Server Notifications");
    const notifHeaderContainer = notifHeader.parentElement as HTMLElement;
    const notifClearButton = within(notifHeaderContainer).getByRole("button", {
      name: "Clear",
    });
    fireEvent.click(notifClearButton);

    // Notifications should now be empty
    expect(screen.getByText("No notifications yet")).toBeTruthy();
  });
});
