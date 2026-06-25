import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "@jest/globals";
import { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { Tabs } from "../ui/tabs";
import ConsoleTab from "../ConsoleTab";

const makeLog = (level: string, data: string): ServerNotification => ({
  method: "notifications/message",
  params: { level, data },
});

const makeOther = (): ServerNotification => ({
  method: "notifications/progress",
  params: { progressToken: "t", progress: 1, total: 10 },
});

const renderConsole = (logs: ServerNotification[] = []) =>
  render(
    <Tabs defaultValue="console">
      <ConsoleTab serverLogs={logs} />
    </Tabs>,
  );

describe("ConsoleTab", () => {
  it("shows empty state when no logs are present", () => {
    renderConsole([]);
    expect(screen.getByText(/No server logs yet/)).toBeTruthy();
  });

  it("renders only notifications/message entries, ignoring other notification types", () => {
    renderConsole([makeLog("info", "hello"), makeOther()]);
    expect(screen.getByText("hello")).toBeTruthy();
    // "notifications/progress" data should not appear
    expect(screen.queryByText(/progressToken/)).toBeNull();
  });

  it("does not render non-message notifications", () => {
    renderConsole([makeOther(), makeOther()]);
    expect(screen.getByText(/No server logs yet/)).toBeTruthy();
  });

  it("clears displayed entries when Clear is clicked without mutating the serverLogs array", () => {
    const logs: ServerNotification[] = [
      makeLog("info", "msg-one"),
      makeLog("error", "msg-two"),
    ];
    renderConsole(logs);

    expect(screen.getByText("msg-one")).toBeTruthy();
    expect(screen.getByText("msg-two")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByText("msg-one")).toBeNull();
    expect(screen.queryByText("msg-two")).toBeNull();
    // Original array is untouched
    expect(logs).toHaveLength(2);
  });

  it("disables Clear when there are no visible log entries", () => {
    renderConsole([]);
    const btn = screen.getByRole("button", { name: "Clear" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows new entries added after Clear", () => {
    const logs: ServerNotification[] = [makeLog("info", "before-clear")];
    const { rerender } = renderConsole(logs);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("before-clear")).toBeNull();

    const extended = [...logs, makeLog("info", "after-clear")];
    rerender(
      <Tabs defaultValue="console">
        <ConsoleTab serverLogs={extended} />
      </Tabs>,
    );

    expect(screen.queryByText("before-clear")).toBeNull();
    expect(screen.getByText("after-clear")).toBeTruthy();
  });

  it("clamps clearedCount when the upstream notifications array is reset to empty", () => {
    const logs: ServerNotification[] = [
      makeLog("info", "msg-a"),
      makeLog("info", "msg-b"),
    ];
    const { rerender } = renderConsole(logs);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("msg-a")).toBeNull();

    // Simulate the parent clearing notifications (e.g. History/Notifications panel Clear)
    rerender(
      <Tabs defaultValue="console">
        <ConsoleTab serverLogs={[]} />
      </Tabs>,
    );

    // Now add a new message — it must be visible (not hidden by a stale clearedCount)
    rerender(
      <Tabs defaultValue="console">
        <ConsoleTab serverLogs={[makeLog("info", "fresh-msg")]} />
      </Tabs>,
    );

    expect(screen.getByText("fresh-msg")).toBeTruthy();
  });
});
