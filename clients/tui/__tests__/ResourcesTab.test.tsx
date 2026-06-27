import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { ResourcesTab } from "../src/components/ResourcesTab.js";

interface ResourceTemplate {
  name: string;
  uriTemplate: string;
  description?: string;
}

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and after rerender() before asserting. The longer delay also lets the async
// readResource effect + setState settle.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const makeResource = (over: Partial<Resource> = {}): Resource =>
  ({
    name: "res-alpha",
    uri: "file:///a",
    ...over,
  }) as unknown as Resource;

// r0: full resource (multi-line description, uri, mimeType)
// r1: no name → header/label fall back to uri
// r2: no name and no uri → "Resource N" label fallback + index key + falsy uri
const resources: Resource[] = [
  makeResource({
    name: "res-alpha",
    uri: "file:///a",
    mimeType: "text/plain",
    description: "Desc one\nDesc two",
  }),
  makeResource({ name: undefined, uri: "file:///b" }),
  makeResource({ name: undefined, uri: undefined }),
];

// t0: full template (description + uriTemplate)
// t1: no name and no uriTemplate → "Template N" label + index key, no uri line
const templates: ResourceTemplate[] = [
  {
    name: "tmpl-alpha",
    uriTemplate: "file:///{id}",
    description: "Template desc",
  },
  { name: "", uriTemplate: "" },
];

describe("ResourcesTab", () => {
  it("renders empty state when there are no resources or templates", () => {
    const { lastFrame } = render(
      <ResourcesTab
        resources={[]}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Resources (0)");
    expect(frame).toContain("No resources available");
    expect(frame).toContain("Select a resource or template to view details");
  });

  it("renders resources and templates with the first resource selected (unfocused)", () => {
    const { lastFrame } = render(
      <ResourcesTab
        resources={resources}
        resourceTemplates={templates}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Resources (5)");
    expect(frame).toContain("res-alpha");
    // r1 label falls back to uri
    expect(frame).toContain("file:///b");
    // r2 label falls back to "Resource N"
    expect(frame).toContain("Resource 3");
    expect(frame).toContain("tmpl-alpha");
    // t1 label falls back to "Template N"
    expect(frame).toContain("Template 2");
    expect(frame).toContain("▶ ");
    // first resource details (cyan branch)
    expect(frame).toContain("Desc one");
    expect(frame).toContain("Desc two");
    expect(frame).toContain("URI: file:///a");
    expect(frame).toContain("MIME Type: text/plain");
    expect(frame).toContain("[Enter to Fetch Resource]");
  });

  it("shows the resource header uri fallback when the resource has no name", () => {
    const { lastFrame } = render(
      <ResourcesTab
        resources={[makeResource({ name: undefined, uri: "file:///only" })]}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    expect(lastFrame() ?? "").toContain("file:///only");
  });

  it("renders template details when a template is selected", () => {
    const { lastFrame } = render(
      <ResourcesTab
        resources={[]}
        resourceTemplates={[templates[0]]}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("tmpl-alpha");
    expect(frame).toContain("Template desc");
    expect(frame).toContain("URI Template: file:///{id}");
    expect(frame).toContain("[Enter to Fetch Resource]");
  });

  it("moves selection down/up with arrow keys when the list is focused", async () => {
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={resources}
        resourceTemplates={templates}
        inspectorClient={null}
        width={120}
        height={30}
        focusedPane="list"
      />,
    );
    // up at top boundary: no movement
    stdin.write(UP);
    await tick();
    // down to r1 (no name, uri only)
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("URI: file:///b");
    // back up to r0
    stdin.write(UP);
    await tick();
    expect(lastFrame() ?? "").toContain("Desc one");
  });

  it("scrolls the visible window when navigating past the viewport", async () => {
    // height 9 → visibleCount = 2; 5 items force firstVisible to advance
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={resources}
        resourceTemplates={templates}
        inspectorClient={null}
        width={120}
        height={9}
        focusedPane="list"
      />,
    );
    for (let i = 0; i < 6; i++) {
      stdin.write(DOWN);
      await tick();
    }
    // last item is the second template ("Template 2")
    expect(lastFrame() ?? "").toContain("Template 2");
    // down boundary: pressing down again does nothing
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("Template 2");
  });

  it("fetches resource content on Enter and renders it", async () => {
    const result = { contents: [{ uri: "file:///a", text: "hello world" }] };
    const readResource = vi.fn().mockResolvedValue({ result });
    const onFetchResource = vi.fn();
    const inspectorClient = { readResource } as unknown as InspectorClient;
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchResource={onFetchResource}
      />,
    );
    stdin.write("\r");
    await tick();
    await tick();
    expect(readResource).toHaveBeenCalledWith("file:///a");
    expect(onFetchResource).toHaveBeenCalledWith(resources[0]);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Content:");
    expect(frame).toContain("hello world");
  });

  it("renders the Error message when readResource rejects with an Error", async () => {
    const readResource = vi.fn().mockRejectedValue(new Error("read boom"));
    const inspectorClient = { readResource } as unknown as InspectorClient;
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchResource={vi.fn()}
      />,
    );
    stdin.write("\r");
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("read boom");
  });

  it("falls back to a generic Error message when readResource rejects with a non-Error", async () => {
    const readResource = vi.fn().mockRejectedValue("nope");
    const inspectorClient = { readResource } as unknown as InspectorClient;
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchResource={vi.fn()}
      />,
    );
    stdin.write("\r");
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("Failed to read resource");
  });

  it("calls onFetchTemplate when Enter is pressed on a template", async () => {
    const onFetchTemplate = vi.fn();
    const inspectorClient = {
      readResource: vi.fn(),
    } as unknown as InspectorClient;
    const { stdin } = render(
      <ResourcesTab
        resources={[]}
        resourceTemplates={[templates[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchTemplate={onFetchTemplate}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onFetchTemplate).toHaveBeenCalledWith(templates[0]);
  });

  it("handles details-pane scrolling, footers, and zoom shortcut after fetch", async () => {
    const result = { contents: [{ uri: "file:///a", text: "zoom me" }] };
    const readResource = vi.fn().mockResolvedValue({ result });
    const onViewDetails = vi.fn();
    const inspectorClient = { readResource } as unknown as InspectorClient;
    const { lastFrame, stdin } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="details"
        onViewDetails={onViewDetails}
        onFetchResource={vi.fn()}
      />,
    );
    // no content yet → "Enter to fetch" footer variant
    expect(lastFrame() ?? "").toContain("Enter to fetch, ↑/↓ to scroll");
    // scroll keys (scrollBy / pageUp / pageDown branches)
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    // fetch content via Enter (works from the details pane too)
    stdin.write("\r");
    await tick();
    await tick();
    // footer switches to the zoom variant
    expect(lastFrame() ?? "").toContain("↑/↓ to scroll, + to zoom");
    // "+" opens the full-screen modal with the fetched content
    stdin.write("+");
    await tick();
    expect(onViewDetails).toHaveBeenCalledWith({ content: result });
  });

  it("shows the template fetch footer when a template is focused in details", () => {
    const { lastFrame } = render(
      <ResourcesTab
        resources={[]}
        resourceTemplates={[templates[0]]}
        inspectorClient={null}
        width={120}
        height={30}
        focusedPane="details"
      />,
    );
    expect(lastFrame() ?? "").toContain("Enter to fetch");
  });

  it("does not fire input handlers when a modal is open", async () => {
    const onFetchResource = vi.fn();
    const inspectorClient = {
      readResource: vi.fn(),
    } as unknown as InspectorClient;
    const { stdin } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchResource={onFetchResource}
        modalOpen={true}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onFetchResource).not.toHaveBeenCalled();
  });

  it("invokes onCountChange and clears fetched content when the resources list changes", async () => {
    const result = { contents: [{ uri: "file:///a", text: "stale" }] };
    const readResource = vi.fn().mockResolvedValue({ result });
    const onCountChange = vi.fn();
    const inspectorClient = { readResource } as unknown as InspectorClient;
    const { lastFrame, stdin, rerender } = render(
      <ResourcesTab
        resources={[resources[0]]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onCountChange={onCountChange}
        onFetchResource={vi.fn()}
      />,
    );
    // fetch content for the first resource
    stdin.write("\r");
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("stale");

    // swapping in a new resources array clears content and updates the count
    const nextResources = [resources[0], resources[1]];
    rerender(
      <ResourcesTab
        resources={nextResources}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onCountChange={onCountChange}
        onFetchResource={vi.fn()}
      />,
    );
    await tick();
    expect(onCountChange).toHaveBeenCalledWith(2);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("stale");
    expect(frame).toContain("[Enter to Fetch Resource]");
  });
});
