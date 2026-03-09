import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect, jest } from "@jest/globals";
import HistoryAndNotifications from "../HistoryAndNotifications";
import { RequestHistoryEntry } from "@/lib/types/requestHistory";
import { TimestampedNotification } from "@/lib/notificationTypes";

// Mock JsonView component
jest.mock("../JsonView", () => {
  return function JsonView({ data }: { data: string }) {
    return <div data-testid="json-view">{data}</div>;
  };
});

describe("HistoryAndNotifications", () => {
  const mockRequestHistory: RequestHistoryEntry[] = [
    {
      request: JSON.stringify({ method: "test/method1", params: {} }),
      response: JSON.stringify({ result: "success" }),
      requestedAt: "2026-01-15T14:34:56.000Z",
      respondedAt: "2026-01-15T14:34:56.245Z",
      durationMs: 245,
    },
    {
      request: JSON.stringify({ method: "test/method2", params: {} }),
      response: JSON.stringify({ result: "success" }),
      requestedAt: "2026-01-15T14:35:00.000Z",
      respondedAt: "2026-01-15T14:35:02.400Z",
      durationMs: 2400,
    },
  ];

  const mockNotifications: TimestampedNotification[] = [
    {
      notification: {
        method: "notifications/message",
        params: {
          level: "info" as const,
          data: "First notification",
        },
      },
      receivedAt: "2026-01-15T14:34:56.000Z",
    },
    {
      notification: {
        method: "notifications/progress",
        params: {
          progressToken: "test-token",
          progress: 50,
          total: 100,
        },
      },
      receivedAt: "2026-01-15T14:35:00.000Z",
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
    expect(screen.getByText(/2\.\s+test\/method2/)).toBeTruthy();
    expect(screen.getByText(/1\.\s+test\/method1/)).toBeTruthy();
  });

  it("displays duration badges on request history items", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    // Check for duration badges
    expect(screen.getByText("245ms")).toBeTruthy();
    expect(screen.getByText("2.4s")).toBeTruthy();
  });

  it("displays server notifications with correct numbering", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    // Items should be numbered in reverse order (newest first)
    expect(screen.getByText(/2\.\s+notifications\/progress/)).toBeTruthy();
    expect(screen.getByText(/1\.\s+notifications\/message/)).toBeTruthy();
  });

  it("expands and collapses request items when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    const firstRequestHeader = screen.getByText(/2\.\s+test\/method2/);

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

  it("shows timing details when expanded", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    const firstRequestHeader = screen.getByText(/2\.\s+test\/method2/);

    // Click to expand
    fireEvent.click(firstRequestHeader);

    // Should show timing details
    expect(screen.getByText(/Requested:/)).toBeTruthy();
    expect(screen.getByText(/Responded:/)).toBeTruthy();
  });

  it("expands and collapses notification items when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    const firstNotificationHeader = screen.getByText(
      /2\.\s+notifications\/progress/,
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

  it("shows received timestamp when notification is expanded", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    const firstNotificationHeader = screen.getByText(
      /2\.\s+notifications\/progress/,
    );

    // Click to expand
    fireEvent.click(firstNotificationHeader);

    // Should show received timestamp
    expect(screen.getByText(/Received:/)).toBeTruthy();
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
      /1\.\s+notifications\/message/,
    );
    fireEvent.click(olderNotificationHeader);

    // Verify it's expanded
    expect(screen.getByText("Details:")).toBeTruthy();

    // Add a new notification at the beginning (simulating real behavior)
    const newNotifications: TimestampedNotification[] = [
      {
        notification: {
          method: "notifications/resources/updated",
          params: { uri: "file://test.txt" },
        },
        receivedAt: "2026-01-15T14:36:00.000Z",
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
    expect(screen.getByText(/3\.\s+notifications\/progress/)).toBeTruthy();
    expect(screen.getByText(/2\.\s+notifications\/message/)).toBeTruthy();
    expect(
      screen.getByText(/1\.\s+notifications\/resources\/updated/),
    ).toBeTruthy();

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
    const olderRequestHeader = screen.getByText(/1\.\s+test\/method1/);
    fireEvent.click(olderRequestHeader);

    // Verify it's expanded
    expect(screen.getByText("Request:")).toBeTruthy();
    expect(screen.getByText("Response:")).toBeTruthy();

    // Add a new request at the beginning
    const newRequestHistory: RequestHistoryEntry[] = [
      {
        request: JSON.stringify({ method: "test/new_method", params: {} }),
        response: JSON.stringify({ result: "new success" }),
        requestedAt: "2026-01-15T14:36:00.000Z",
        respondedAt: "2026-01-15T14:36:00.100Z",
        durationMs: 100,
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
    expect(screen.getByText(/3\.\s+test\/method2/)).toBeTruthy();
    expect(screen.getByText(/2\.\s+test\/method1/)).toBeTruthy();
    expect(screen.getByText(/1\.\s+test\/new_method/)).toBeTruthy();

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
      const [history, setHistory] =
        useState<RequestHistoryEntry[]>(mockRequestHistory);
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
    expect(screen.getByText(/2\.\s+test\/method2/)).toBeTruthy();
    expect(screen.getByText(/1\.\s+test\/method1/)).toBeTruthy();

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
        useState<TimestampedNotification[]>(mockNotifications);
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
    expect(screen.getByText(/2\.\s+notifications\/progress/)).toBeTruthy();
    expect(screen.getByText(/1\.\s+notifications\/message/)).toBeTruthy();

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

  it("handles requests without response timing", () => {
    const pendingRequest: RequestHistoryEntry[] = [
      {
        request: JSON.stringify({ method: "test/pending", params: {} }),
        requestedAt: "2026-01-15T14:34:56.000Z",
        // No response, respondedAt, or durationMs
      },
    ];

    render(
      <HistoryAndNotifications
        requestHistory={pendingRequest}
        serverNotifications={[]}
      />,
    );

    // Should render without duration badge (look for the badge element by class)
    expect(screen.getByText(/1\.\s+test\/pending/)).toBeTruthy();
    // The duration badge has specific styling - check it's not present
    expect(
      screen.queryByText(/^\d+ms$|^\d+\.\d+s$|^\d+s$|^\d+m\s*\d*s?$/),
    ).toBeNull();
  });
});
