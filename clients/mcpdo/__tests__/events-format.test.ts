/**
 * The mcpdo pieces of Events support (#3032) that need no daemon: how the
 * event arguments are read off the command line, and how `events/list`,
 * `events/poll` and `events/stream` output reads in the default text format.
 */
import { describe, it, expect } from "vitest";
import {
  parseToolCallPositionals,
  resolveEventArgs,
} from "../src/connection/parse-tool-args.js";
import {
  formatEventPollHuman,
  formatEventTypesHuman,
  formatRpcResultHuman,
  formatStreamEventHuman,
} from "../src/connection/format-human.js";

describe("resolveEventArgs", () => {
  it("takes the positional name and key:=value arguments", () => {
    expect(
      resolveEventArgs({
        eventNamePos: "deploy.completed",
        eventArgsPos: ["region:=us-west1", "count:=2"],
      }),
    ).toEqual({
      eventName: "deploy.completed",
      eventArgs: { region: "us-west1", count: 2 },
    });
  });

  it("takes --event-name and --event-arg", () => {
    expect(
      resolveEventArgs({
        eventNameFlag: "deploy.completed",
        eventArgFlag: { region: "eu" },
      }),
    ).toEqual({ eventName: "deploy.completed", eventArgs: { region: "eu" } });
  });

  it("reads the name slot as an argument when the name came from the flag", () => {
    expect(
      resolveEventArgs({
        eventNameFlag: "deploy.completed",
        eventNamePos: "region:=us",
        eventArgsPos: [],
      }),
    ).toEqual({ eventName: "deploy.completed", eventArgs: { region: "us" } });
  });

  it("refuses positionals and --event-arg together", () => {
    expect(() =>
      resolveEventArgs({
        eventNamePos: "x",
        eventArgsPos: ["a:=1"],
        eventArgFlag: { b: 2 },
      }),
    ).toThrow(/one style/);
  });

  it("defaults to no arguments", () => {
    expect(resolveEventArgs({})).toEqual({
      eventName: undefined,
      eventArgs: {},
    });
  });

  it("names events, not tools, in its parse errors", () => {
    expect(() => parseToolCallPositionals(["oops"], "event")).toThrow(
      /Invalid event argument "oops"/,
    );
    expect(() => parseToolCallPositionals(["{}", "x"], "event")).toThrow(
      /after the event name/,
    );
    // The tool wording is unchanged.
    expect(() => parseToolCallPositionals(["oops"])).toThrow(
      /Invalid tool argument "oops"/,
    );
  });
});

describe("events human output", () => {
  it("lists event types with their modes, then the excluded ones", () => {
    const text = formatEventTypesHuman({
      events: [
        { name: "a.b", delivery: ["poll", "push"], description: "Thing" },
      ],
      excluded: [{ name: "bad", reason: "not a token" }],
    });
    expect(text).toContain("Event types (1):");
    expect(text).toContain("`a.b` [poll, push] — Thing");
    expect(text).toContain("Excluded (1):");
    expect(text).toContain("`bad` — not a token");
  });

  it("says (none) for an empty list and omits an empty excluded section", () => {
    const text = formatEventTypesHuman({ events: [], excluded: [] });
    expect(text).toContain("(none)");
    expect(text).not.toContain("Excluded");
    // A malformed entry still renders rather than throwing.
    expect(formatEventTypesHuman({ events: [{}], excluded: [{}] })).toContain(
      "`?` []",
    );
  });

  it("shows a poll's occurrences as inert JSON, and the cursor to pass back", () => {
    const text = formatEventPollHuman({
      events: [
        {
          eventId: "e1",
          name: "a.b",
          timestamp: "2026-11-24T00:00:00Z",
          data: { msg: "\u001b[31mred" },
        },
      ],
      cursor: "cur_1",
      hasMore: false,
      truncated: true,
      nextPollMs: 5000,
    });
    expect(text).toContain("Events (1):");
    expect(text).toContain("`e1` a.b 2026-11-24T00:00:00Z");
    // JSON.stringify escapes the control character: the payload cannot style
    // or move the terminal.
    expect(text).toContain('{"msg":"\\u001b[31mred"}');
    expect(text).toContain("Truncated");
    expect(text).toContain("cursor: cur_1");
    expect(text).toContain("nextPollMs: 5000");
  });

  it("says to poll again on hasMore, and prints a null cursor", () => {
    const text = formatEventPollHuman({
      events: [],
      cursor: null,
      hasMore: true,
    });
    expect(text).toContain("(none)");
    expect(text).toContain("cursor: null");
    expect(text).toContain("hasMore: poll again now");
    expect(formatEventPollHuman({ events: [{}] })).toContain("`?`");
  });

  it("dispatches events/list and events/poll results", () => {
    expect(
      formatRpcResultHuman("events/list", { events: [], excluded: [] }),
    ).toContain("Event types (0):");
    expect(formatRpcResultHuman("events/poll", { events: [] })).toContain(
      "Events (0):",
    );
  });

  it.each([
    [
      { type: "subscribed", name: "a.b", mode: "push", arguments: {} },
      "Subscribed: `a.b` (push)",
    ],
    [
      { type: "active", name: "a.b", cursor: "cur_0", heartbeatMs: 30000 },
      "Active: cursor cur_0 — heartbeat 30000ms",
    ],
    [{ type: "active", name: "a.b", cursor: null }, "Active: cursor null"],
    [
      {
        type: "event",
        eventId: "e1",
        name: "a.b",
        timestamp: "t",
        data: { a: 1 },
        payload: "invalid",
        payloadError: "missing x",
      },
      "payload does not match its schema: missing x",
    ],
    [
      {
        type: "event",
        eventId: "e2",
        name: "a.b",
        timestamp: "t",
        data: {},
        payload: "unchecked",
      },
      "(payload not checked)",
    ],
    [{ type: "gap", cursor: "cur_5" }, "resuming at cursor cur_5"],
    [{ type: "gap", cursor: null }, "resuming at cursor null"],
    [
      { type: "error", error: { code: -32025, message: "busy" } },
      "Error -32025: busy",
    ],
    [{ type: "error" }, "Error : "],
    [
      { type: "reconnect", reason: "stream ended" },
      "Reconnecting: stream ended",
    ],
    [
      {
        type: "terminated",
        reason: "removed",
        error: { code: -32023, message: "gone" },
      },
      "Terminated (removed): gone",
    ],
    [{ type: "terminated" }, "Terminated (): "],
  ])("renders stream line %j", (line, expected) => {
    expect(formatStreamEventHuman(line)).toContain(expected);
  });

  it("does not read a verdict off a poll result's occurrences", () => {
    const text = formatEventPollHuman({
      events: [
        {
          eventId: "e1",
          name: "a",
          timestamp: "t",
          data: {},
          payload: "invalid",
        },
      ],
    });
    expect(text).not.toContain("does not match");
    const valid = formatStreamEventHuman({
      type: "event",
      eventId: "e1",
      name: "a",
      timestamp: "t",
      data: {},
      payload: "valid",
    });
    expect(valid).not.toContain("payload");
  });

  it("leaves a resource subscription's subscribed line to the resource branch", () => {
    expect(
      formatStreamEventHuman({ type: "subscribed", uri: "file:///x" }),
    ).toContain("file:///x");
  });
});
