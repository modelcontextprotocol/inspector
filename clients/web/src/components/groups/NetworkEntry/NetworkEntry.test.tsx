import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { NetworkEntry } from "./NetworkEntry";

const baseEntry: FetchRequestEntry = {
  id: "n-1",
  timestamp: new Date("2026-03-17T10:00:00Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "x-test": "hello" },
  requestBody: '{"foo":"bar"}',
  responseStatus: 200,
  responseStatusText: "OK",
  responseHeaders: { "content-type": "application/json" },
  responseBody: '{"ok":true}',
  duration: 45,
  category: "transport",
};

describe("NetworkEntry", () => {
  it("renders timestamp, method, URL, status, duration, and category", () => {
    renderWithMantine(
      <NetworkEntry entry={baseEntry} isListExpanded={false} />,
    );
    expect(screen.getByText("POST")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
    expect(screen.getByText("200 OK")).toBeInTheDocument();
    expect(screen.getByText("45ms")).toBeInTheDocument();
    expect(screen.getByText("transport")).toBeInTheDocument();
  });

  it("renders the compact two-line layout (line 1 meta, line 2 URL) when embedded", () => {
    renderWithMantine(
      <NetworkEntry entry={baseEntry} isListExpanded={false} embedded />,
    );
    // Line 1: compact time-only timestamp, method, category, duration, status.
    expect(screen.getByText("10:00:00")).toBeInTheDocument();
    expect(
      screen.queryByText("2026-03-17T10:00:00.000Z"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("POST")).toBeInTheDocument();
    expect(screen.getByText("transport")).toBeInTheDocument();
    expect(screen.getByText("45ms")).toBeInTheDocument();
    expect(screen.getByText("200 OK")).toBeInTheDocument();
    // Line 2: the URL (in its scroll area) and the expand toggle.
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  it("shows body / header detail when expanded", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <NetworkEntry entry={baseEntry} isListExpanded={false} />,
    );
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Request Headers")).toBeInTheDocument();
    expect(screen.getByText("x-test")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Request Body")).toBeInTheDocument();
    expect(screen.getByText("Response Headers")).toBeInTheDocument();
    expect(screen.getByText("Response Body")).toBeInTheDocument();
  });

  it("renders without response when status is missing (pending)", () => {
    const pending: FetchRequestEntry = {
      ...baseEntry,
      responseStatus: undefined,
      responseStatusText: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      duration: undefined,
    };
    renderWithMantine(<NetworkEntry entry={pending} isListExpanded={false} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders Error label and surfaces the error message when expanded", () => {
    const errored: FetchRequestEntry = {
      ...baseEntry,
      responseStatus: undefined,
      responseStatusText: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      error: "ECONNRESET",
    };
    renderWithMantine(<NetworkEntry entry={errored} isListExpanded={true} />);
    expect(screen.getAllByText("Error").length).toBeGreaterThan(0);
    expect(screen.getByText("ECONNRESET")).toBeInTheDocument();
  });

  it("renders status labels across HTTP classes", () => {
    const cases: Array<[number, string]> = [
      [201, "201"],
      [301, "301"],
      [404, "404"],
      [500, "500"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = renderWithMantine(
        <NetworkEntry
          entry={{
            ...baseEntry,
            id: `n-${status}`,
            responseStatus: status,
            responseStatusText: undefined,
          }}
          isListExpanded={false}
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows headers placeholder when none are present", async () => {
    const user = userEvent.setup();
    const noHeaders: FetchRequestEntry = {
      ...baseEntry,
      requestHeaders: {},
      responseHeaders: {},
    };
    renderWithMantine(
      <NetworkEntry entry={noHeaders} isListExpanded={false} />,
    );
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getAllByText("(none)").length).toBe(2);
  });

  it("shows a 'long-lived stream' placeholder when a GET SSE response has no body", async () => {
    const user = userEvent.setup();
    const sse: FetchRequestEntry = {
      ...baseEntry,
      method: "GET",
      responseHeaders: { "content-type": "text/event-stream" },
      responseBody: undefined,
    };
    renderWithMantine(<NetworkEntry entry={sse} isListExpanded={false} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Response Body")).toBeInTheDocument();
    expect(
      screen.getByText(/Long-lived stream — body not captured/),
    ).toBeInTheDocument();
  });

  it("shows an SSE badge on long-lived GET event-stream entries", () => {
    const sse: FetchRequestEntry = {
      ...baseEntry,
      method: "GET",
      responseHeaders: { "content-type": "text/event-stream" },
      responseBody: undefined,
    };
    renderWithMantine(<NetworkEntry entry={sse} isListExpanded={false} />);
    expect(screen.getByText("SSE")).toBeInTheDocument();
  });

  it("does not show an SSE badge on bounded POST entries", () => {
    renderWithMantine(
      <NetworkEntry entry={baseEntry} isListExpanded={false} />,
    );
    expect(screen.queryByText("SSE")).not.toBeInTheDocument();
  });

  it("shows '(empty)' for a POST SSE response with no body (bounded stream where capture failed)", async () => {
    const user = userEvent.setup();
    const sse: FetchRequestEntry = {
      ...baseEntry,
      method: "POST",
      responseHeaders: { "content-type": "text/event-stream" },
      responseBody: undefined,
    };
    renderWithMantine(<NetworkEntry entry={sse} isListExpanded={false} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("shows '(empty)' for a non-streaming response with no body", async () => {
    const user = userEvent.setup();
    const empty: FetchRequestEntry = {
      ...baseEntry,
      responseHeaders: { "content-type": "application/json" },
      responseBody: undefined,
    };
    renderWithMantine(<NetworkEntry entry={empty} isListExpanded={false} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Response Body")).toBeInTheDocument();
    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("omits the Response Body section entirely when no response was received", async () => {
    const user = userEvent.setup();
    const pending: FetchRequestEntry = {
      ...baseEntry,
      responseStatus: undefined,
      responseStatusText: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      duration: undefined,
    };
    renderWithMantine(<NetworkEntry entry={pending} isListExpanded={false} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.queryByText("Response Body")).not.toBeInTheDocument();
  });

  it("shows a 'too large' notice when a body exceeds the inline preview limit", async () => {
    const user = userEvent.setup();
    const huge = "x".repeat(150_000);
    const big: FetchRequestEntry = {
      ...baseEntry,
      requestBody: huge,
    };
    renderWithMantine(<NetworkEntry entry={big} isListExpanded={false} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText(/Body too large to preview/)).toBeInTheDocument();
  });

  it("masks token-response secrets until revealed, then shows the raw value", async () => {
    const user = userEvent.setup();
    const authEntry: FetchRequestEntry = {
      ...baseEntry,
      category: "auth",
      url: "http://localhost:3001/token",
      requestBody: undefined,
      responseBody: JSON.stringify({
        access_token: "super-secret-token",
        token_type: "Bearer",
      }),
    };
    const { container } = renderWithMantine(
      <NetworkEntry entry={authEntry} isListExpanded={true} />,
    );
    // Masked by default: the reveal affordance is present and the raw secret
    // is nowhere in the DOM, but non-secret fields still render.
    expect(screen.getByText("Secrets hidden")).toBeInTheDocument();
    expect(container.textContent).not.toContain("super-secret-token");
    expect(container.textContent).toContain("••••••••");
    expect(container.textContent).toContain("Bearer");

    await user.click(
      screen.getByRole("button", { name: "Reveal secrets in body" }),
    );

    expect(screen.getByText("Secrets revealed")).toBeInTheDocument();
    expect(container.textContent).toContain("super-secret-token");

    // Toggling back re-masks.
    await user.click(
      screen.getByRole("button", { name: "Hide secrets in body" }),
    );
    expect(container.textContent).not.toContain("super-secret-token");
  });

  it("masks a form-encoded request body (code/verifier) until revealed", async () => {
    const user = userEvent.setup();
    const authEntry: FetchRequestEntry = {
      ...baseEntry,
      category: "auth",
      url: "http://localhost:3001/token",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      requestBody:
        "grant_type=authorization_code&code=SECRETCODE&code_verifier=SECRETVERIFIER",
      responseStatus: undefined,
      responseStatusText: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
    };
    const { container } = renderWithMantine(
      <NetworkEntry entry={authEntry} isListExpanded={true} />,
    );
    expect(screen.getByText("Secrets hidden")).toBeInTheDocument();
    expect(container.textContent).not.toContain("SECRETCODE");
    expect(container.textContent).not.toContain("SECRETVERIFIER");
    expect(container.textContent).toContain("••••••••");
    // Non-secret param stays visible.
    expect(container.textContent).toContain("grant_type=authorization_code");

    await user.click(
      screen.getByRole("button", { name: "Reveal secrets in body" }),
    );
    expect(container.textContent).toContain("SECRETCODE");
    expect(container.textContent).toContain("SECRETVERIFIER");
  });

  it("does not add a reveal toggle for non-secret bodies", () => {
    renderWithMantine(<NetworkEntry entry={baseEntry} isListExpanded={true} />);
    expect(screen.queryByText("Secrets hidden")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reveal secrets in body" }),
    ).not.toBeInTheDocument();
  });

  it("labels an auth-category request with its OAuth flow phase", () => {
    const tokenRequest: FetchRequestEntry = {
      ...baseEntry,
      url: "https://as.example.com/oauth/token",
      category: "auth",
    };
    renderWithMantine(
      <NetworkEntry entry={tokenRequest} isListExpanded={false} />,
    );
    expect(screen.getByText("Token")).toBeInTheDocument();
  });

  it("does not label transport requests or unrecognized auth URLs", () => {
    renderWithMantine(
      <NetworkEntry entry={baseEntry} isListExpanded={false} />,
    );
    expect(screen.queryByText("Token")).not.toBeInTheDocument();
    expect(screen.queryByText("Discovery")).not.toBeInTheDocument();
  });

  describe("modern Streamable HTTP awareness (SEP-2243 / SEP-2575)", () => {
    /** Mirror of the SDK's sentinel encoding, for building test inputs. */
    function encodeSentinel(value: string): string {
      const bytes = new TextEncoder().encode(value);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return `=?base64?${btoa(bin)}?=`;
    }

    it("decodes a sentinel-encoded Mcp-Name header and flags it as base64", () => {
      const entry: FetchRequestEntry = {
        ...baseEntry,
        requestHeaders: {
          "mcp-method": "tools/call",
          "mcp-name": encodeSentinel("get weather ☀"),
        },
        requestBody: JSON.stringify({
          method: "tools/call",
          params: { name: "get weather ☀" },
        }),
      };
      renderWithMantine(<NetworkEntry entry={entry} isListExpanded={true} />);
      expect(screen.getByText("get weather ☀")).toBeInTheDocument();
      expect(screen.getByText("base64")).toBeInTheDocument();
    });

    it("marks a header that disagrees with the request body", () => {
      const entry: FetchRequestEntry = {
        ...baseEntry,
        requestHeaders: { "mcp-method": "tools/list" },
        requestBody: JSON.stringify({ method: "tools/call", params: {} }),
      };
      renderWithMantine(<NetworkEntry entry={entry} isListExpanded={true} />);
      expect(
        screen.getByLabelText(
          /Header does not match body; expected tools\/call/,
        ),
      ).toBeInTheDocument();
    });

    it("does NOT badge a spec error (those live in the Protocol tab now)", () => {
      // A -32020 response is still a plain HTTP entry here; the distinct
      // spec-error chip/alert moved to the Protocol tab.
      const entry: FetchRequestEntry = {
        ...baseEntry,
        responseStatus: 400,
        responseStatusText: "Bad Request",
        responseBody: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32020, message: "Mcp-Method mismatch" },
        }),
      };
      renderWithMantine(<NetworkEntry entry={entry} isListExpanded={true} />);
      expect(screen.getByText("400 Bad Request")).toBeInTheDocument();
      expect(
        screen.queryByText("-32020 HeaderMismatch"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Server supports:/)).not.toBeInTheDocument();
    });

    it("when revealed, force-expands, scrolls into view, and clears the signal", async () => {
      const scrollIntoView = vi.fn();
      // happy-dom doesn't implement scrollIntoView; stub it on the prototype.
      Element.prototype.scrollIntoView = scrollIntoView;
      const onRevealComplete = vi.fn();
      renderWithMantine(
        <NetworkEntry
          entry={baseEntry}
          isListExpanded={false}
          revealed
          onRevealComplete={onRevealComplete}
        />,
      );
      // Force-expanded even though isListExpanded is false.
      expect(screen.getByText("Request Headers")).toBeInTheDocument();
      // The one-shot signal is cleared synchronously.
      expect(onRevealComplete).toHaveBeenCalledTimes(1);
      // The scroll runs in a rAF.
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    });

    it("labels a cancelled request as an abort, not a hard error", () => {
      const cancelled: FetchRequestEntry = {
        ...baseEntry,
        responseStatus: undefined,
        responseStatusText: undefined,
        responseHeaders: undefined,
        responseBody: undefined,
        error: "The operation was aborted",
      };
      renderWithMantine(
        <NetworkEntry entry={cancelled} isListExpanded={true} />,
      );
      expect(screen.getByText("Cancelled")).toBeInTheDocument();
      expect(screen.getByText("Request cancelled")).toBeInTheDocument();
      expect(screen.getByText(/notifications\/cancelled/)).toBeInTheDocument();
    });
  });
});
