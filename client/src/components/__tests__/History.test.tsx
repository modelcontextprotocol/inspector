import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, jest } from "@jest/globals";
import HistoryAndNotifications from "../History";
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
      method: "notification/test1",
      params: { message: "First notification" },
    },
    {
      method: "notification/test2",
      params: { message: "Second notification" },
    },
  ];

  it("renders history and notifications sections", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={mockNotifications}
      />,
    );

    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Server Notifications")).toBeInTheDocument();
  });

  it("displays request history items with correct numbering", () => {
    render(
      <HistoryAndNotifications
        requestHistory={mockRequestHistory}
        serverNotifications={[]}
      />,
    );

    // Items should be numbered in reverse order (newest first)
    expect(screen.getByText("2. test/method2")).toBeInTheDocument();
    expect(screen.getByText("1. test/method1")).toBeInTheDocument();
  });

  it("displays server notifications with correct numbering", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    // Items should be numbered in reverse order (newest first)
    expect(screen.getByText("2. notification/test2")).toBeInTheDocument();
    expect(screen.getByText("1. notification/test1")).toBeInTheDocument();
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
    expect(screen.queryByText("Request:")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(firstRequestHeader);

    // Should now be expanded - one ▼ and one ▶
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getAllByText("▶")).toHaveLength(1);
    expect(screen.getByText("Request:")).toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
  });

  it("expands and collapses notification items when clicked", () => {
    render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    const firstNotificationHeader = screen.getByText("2. notification/test2");

    // Initially collapsed
    expect(screen.getAllByText("▶")).toHaveLength(2);
    expect(screen.queryByText("Details:")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(firstNotificationHeader);

    // Should now be expanded
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getAllByText("▶")).toHaveLength(1);
    expect(screen.getByText("Details:")).toBeInTheDocument();
  });

  it("maintains expanded state when new notifications are added", () => {
    const { rerender } = render(
      <HistoryAndNotifications
        requestHistory={[]}
        serverNotifications={mockNotifications}
      />,
    );

    // Find and expand the older notification (should be "1. notification/test1")
    const olderNotificationHeader = screen.getByText("1. notification/test1");
    fireEvent.click(olderNotificationHeader);

    // Verify it's expanded
    expect(screen.getByText("Details:")).toBeInTheDocument();

    // Add a new notification at the beginning (simulating real behavior)
    const newNotifications: ServerNotification[] = [
      {
        method: "notification/new",
        params: { message: "New notification" },
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
    // It's now numbered as "2. notification/test1" due to the new item
    expect(screen.getByText("3. notification/test2")).toBeInTheDocument();
    expect(screen.getByText("2. notification/test1")).toBeInTheDocument();
    expect(screen.getByText("1. notification/new")).toBeInTheDocument();

    // The originally expanded notification should still show its details
    expect(screen.getByText("Details:")).toBeInTheDocument();
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
    expect(screen.getByText("Request:")).toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();

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
    expect(screen.getByText("3. test/method2")).toBeInTheDocument();
    expect(screen.getByText("2. test/method1")).toBeInTheDocument();
    expect(screen.getByText("1. test/new_method")).toBeInTheDocument();

    // The originally expanded request should still show its details
    expect(screen.getByText("Request:")).toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
  });

  it("displays empty state messages when no data is available", () => {
    render(
      <HistoryAndNotifications requestHistory={[]} serverNotifications={[]} />,
    );

    expect(screen.getByText("No history yet")).toBeInTheDocument();
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
  });
});
