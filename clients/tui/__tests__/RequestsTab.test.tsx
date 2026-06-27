import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { FetchRequestEntry } from "@inspector/core/mcp/index.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { RequestsTab } from "../src/components/RequestsTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const TS = new Date("2024-01-01T12:34:56Z");

const req = (over: Partial<FetchRequestEntry>): FetchRequestEntry => ({
  id: "id",
  timestamp: TS,
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "content-type": "application/json" },
  category: "transport",
  ...over,
});

// A fully-populated, successful transport request (2xx, JSON bodies).
const fullRequest = req({
  id: "r0",
  category: "auth",
  method: "GET",
  url: "https://example.com/oauth",
  responseStatus: 200,
  responseStatusText: "OK",
  duration: 12,
  requestHeaders: { authorization: "Bearer x" },
  requestBody: JSON.stringify({ grant_type: "code" }),
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({ access_token: "tok" }),
});

const errorRequest = req({
  id: "r1",
  method: "POST",
  error: "connection refused",
});

const pendingRequest = req({
  id: "r2",
  method: "DELETE",
});

const nonJsonRequest = req({
  id: "r3",
  method: "PUT",
  responseStatus: 404,
  responseStatusText: "Not Found",
  requestBody: "this is not json",
  responseHeaders: {},
  responseBody: "neither is this",
});

const redirectRequest = req({
  id: "r4",
  method: "GET",
  responseStatus: 301,
});

const informationalRequest = req({
  id: "r5",
  method: "GET",
  responseStatus: 100,
});

describe("RequestsTab", () => {
  it("renders the empty state and reports a count of 0", () => {
    const onCountChange = vi.fn();
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[]}
        width={120}
        height={30}
        onCountChange={onCountChange}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Requests (0)");
    expect(frame).toContain("No requests");
    expect(frame).toContain("Select a request to view details");
    expect(onCountChange).toHaveBeenCalledWith(0);
  });

  it("works without an onCountChange callback", () => {
    const { lastFrame } = render(
      <RequestsTab serverName="srv" requests={[]} width={120} height={30} />,
    );
    expect(lastFrame() ?? "").toContain("Requests (0)");
  });

  it("renders the list with status colors, labels and durations", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[
          fullRequest,
          errorRequest,
          pendingRequest,
          informationalRequest,
        ]}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Requests (4)");
    // category labels
    expect(frame).toContain("AUTH");
    expect(frame).toContain("MCP");
    // GET is padded; non-GET methods shown as-is
    expect(frame).toContain("GET");
    expect(frame).toContain("POST");
    // status text variants: numeric / ERROR / "..."
    expect(frame).toContain("200");
    expect(frame).toContain("ERROR");
    expect(frame).toContain("...");
    // duration suffix
    expect(frame).toContain("12ms");
    // selection marker
    expect(frame).toContain("▶ ");
  });

  it("renders full details for a successful request with JSON bodies", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[fullRequest]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("GET https://example.com/oauth");
    expect(frame).toContain("Category:");
    expect(frame).toContain("auth");
    expect(frame).toContain("Status:");
    expect(frame).toContain("200 OK");
    expect(frame).toContain("(12ms)");
    expect(frame).toContain("Request Headers:");
    expect(frame).toContain("authorization: Bearer x");
    expect(frame).toContain("Request Body:");
    expect(frame).toContain("grant_type");
    expect(frame).toContain("Response Headers:");
    expect(frame).toContain("Response Body:");
    expect(frame).toContain("access_token");
  });

  it("renders an error request detail", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[errorRequest]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("transport");
    expect(frame).toContain("Error: connection refused");
  });

  it("renders the in-progress placeholder when there is no status or error", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[pendingRequest]}
        width={120}
        height={40}
      />,
    );
    expect(lastFrame() ?? "").toContain("Request in progress...");
  });

  it("renders raw (non-JSON) request and response bodies", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[nonJsonRequest]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("404 Not Found");
    expect(frame).toContain("this is not json");
    expect(frame).toContain("neither is this");
    // empty responseHeaders object → section omitted
    expect(frame).not.toContain("Response Headers:");
  });

  it("renders a redirect (3xx) status detail", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[redirectRequest]}
        width={120}
        height={40}
      />,
    );
    expect(lastFrame() ?? "").toContain("301");
  });

  it("highlights the details header when the details pane is focused", () => {
    const { lastFrame } = render(
      <RequestsTab
        serverName="srv"
        requests={[fullRequest]}
        width={120}
        height={40}
        focusedPane="details"
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("↑/↓ to scroll, + to zoom");
    expect(frame).toContain("GET https://example.com/oauth");
  });

  it("moves selection with arrows and page keys when the list is focused", async () => {
    const many: FetchRequestEntry[] = Array.from({ length: 8 }, (_, i) =>
      req({
        id: `m${i}`,
        method: i % 2 === 0 ? "GET" : "POST",
        url: `https://example.com/r${i}`,
        responseStatus: 200,
      }),
    );
    const { lastFrame, stdin } = render(
      <RequestsTab
        serverName="srv"
        requests={many}
        width={120}
        height={12}
        focusedPane="requests"
      />,
    );
    // up at top boundary: no movement
    stdin.write(UP);
    await tick();
    // down moves selection to the next request
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("https://example.com/r1");
    // pageDown jumps toward the end
    stdin.write(PAGE_DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("https://example.com/r");
    // pageUp back toward the start
    stdin.write(PAGE_UP);
    await tick();
    // up moves back toward the top
    stdin.write(UP);
    await tick();
    expect(lastFrame() ?? "").toContain("Requests (8)");
  });

  it("clamps at the bottom when paging past the end", async () => {
    const many: FetchRequestEntry[] = Array.from({ length: 4 }, (_, i) =>
      req({ id: `c${i}`, url: `https://example.com/c${i}` }),
    );
    const { lastFrame, stdin } = render(
      <RequestsTab
        serverName="srv"
        requests={many}
        width={120}
        height={10}
        focusedPane="requests"
      />,
    );
    // overshoot down to the last index, then page down past the end
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("https://example.com/c3");
  });

  it("handles details-pane scrolling and the zoom shortcut", async () => {
    const onViewDetails = vi.fn();
    const { lastFrame, stdin } = render(
      <RequestsTab
        serverName="srv"
        requests={[fullRequest]}
        width={120}
        height={40}
        focusedPane="details"
        onViewDetails={onViewDetails}
      />,
    );
    expect(lastFrame() ?? "").toContain("↑/↓ to scroll, + to zoom");
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write("+");
    await tick();
    expect(onViewDetails).toHaveBeenCalledWith(fullRequest);
  });

  it("does not fire input handlers when a modal is open", async () => {
    const onViewDetails = vi.fn();
    const { stdin } = render(
      <RequestsTab
        serverName="srv"
        requests={[fullRequest]}
        width={120}
        height={40}
        focusedPane="details"
        onViewDetails={onViewDetails}
        modalOpen={true}
      />,
    );
    stdin.write("+");
    await tick();
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it("ignores '+' when no onViewDetails handler is provided", async () => {
    const { lastFrame, stdin } = render(
      <RequestsTab
        serverName="srv"
        requests={[fullRequest]}
        width={120}
        height={40}
        focusedPane="details"
      />,
    );
    stdin.write("+");
    await tick();
    // still rendered, no crash
    expect(lastFrame() ?? "").toContain("GET https://example.com/oauth");
  });
});
