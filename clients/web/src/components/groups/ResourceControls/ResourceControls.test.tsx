import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ResourceControls,
  type ResourceControlsProps,
} from "./ResourceControls";

const sampleResources: Resource[] = [
  { name: "config.json", uri: "file:///config.json" },
  { name: "README.md", uri: "file:///README.md" },
];

const sampleTemplates: ResourceTemplate[] = [
  { name: "User Profile", uriTemplate: "file:///users/{userId}/profile" },
];

const sampleSubscriptions: InspectorResourceSubscription[] = [
  {
    resource: { name: "config.json", uri: "file:///config.json" },
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
];

const baseProps = {
  resources: sampleResources,
  templates: sampleTemplates,
  subscriptions: sampleSubscriptions,
  listChanged: false,
  onRefreshList: vi.fn(),
  onSearchChange: vi.fn(),
  onOpenSectionsChange: vi.fn(),
  onSelectUri: vi.fn(),
  onSelectTemplate: vi.fn(),
  onUnsubscribeResource: vi.fn(),
  compact: false,
  onCompactChange: vi.fn(),
};

// ResourceControls is controlled: search text + accordion open-sections live in
// the parent (App, via ResourcesScreen) so they persist across tab navigation
// (#1417). This host holds that state so typing filters the lists and toggling
// the ListToggle drives the accordion, mirroring how App owns it. Props passed
// in override defaults; the stateful search/open-sections wiring is applied last
// so callers can still observe changes via the spied callbacks.
function ControlledResourceControls(props: Partial<ResourceControlsProps>) {
  const [searchText, setSearchText] = useState<string>(props.searchText ?? "");
  const [openSections, setOpenSections] = useState<string[]>(
    props.openSections ?? ["resources", "templates", "subscriptions"],
  );
  return (
    <ResourceControls
      {...baseProps}
      {...props}
      searchText={searchText}
      openSections={openSections}
      onSearchChange={(value) => {
        setSearchText(value);
        props.onSearchChange?.(value);
      }}
      onOpenSectionsChange={(value) => {
        setOpenSections(value);
        props.onOpenSectionsChange?.(value);
      }}
    />
  );
}

describe("ResourceControls", () => {
  it("renders title and section counts", () => {
    renderWithMantine(<ResourceControls {...baseProps} />);
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("URIs (2)")).toBeInTheDocument();
    expect(screen.getByText("Templates (1)")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions (1)")).toBeInTheDocument();
  });

  it("does not show ListChangedIndicator when listChanged is false", () => {
    renderWithMantine(<ResourceControls {...baseProps} />);
    expect(screen.queryByText("List updated")).not.toBeInTheDocument();
  });

  it("shows ListChangedIndicator and triggers onRefreshList when listChanged", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        listChanged
        onRefreshList={onRefreshList}
      />,
    );
    expect(screen.getByText("List updated")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("filters resources, templates, and subscriptions by search text", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledResourceControls />);
    await user.type(screen.getByPlaceholderText("Search..."), "README");
    expect(screen.getByText("URIs (1)")).toBeInTheDocument();
    expect(screen.getByText("Templates (0)")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions (0)")).toBeInTheDocument();
  });

  it("invokes onSelectUri when a resource is clicked", async () => {
    const user = userEvent.setup();
    const onSelectUri = vi.fn();
    renderWithMantine(
      <ResourceControls {...baseProps} onSelectUri={onSelectUri} />,
    );
    await user.click(screen.getByText("README.md"));
    expect(onSelectUri).toHaveBeenCalledWith("file:///README.md");
  });

  it("does not invoke onSelectUri when clicking the already-selected resource", async () => {
    const user = userEvent.setup();
    const onSelectUri = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        selectedUri="file:///README.md"
        onSelectUri={onSelectUri}
      />,
    );
    await user.click(screen.getByText("README.md"));
    expect(onSelectUri).not.toHaveBeenCalled();
  });

  it("invokes onSelectTemplate when a template is clicked", async () => {
    const user = userEvent.setup();
    const onSelectTemplate = vi.fn();
    renderWithMantine(
      <ResourceControls {...baseProps} onSelectTemplate={onSelectTemplate} />,
    );
    await user.click(screen.getByText("User Profile"));
    expect(onSelectTemplate).toHaveBeenCalledWith(
      "file:///users/{userId}/profile",
    );
  });

  it("does not invoke onSelectTemplate when clicking the already-selected template", async () => {
    const user = userEvent.setup();
    const onSelectTemplate = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        selectedTemplateUri="file:///users/{userId}/profile"
        onSelectTemplate={onSelectTemplate}
      />,
    );
    await user.click(screen.getByText("User Profile"));
    expect(onSelectTemplate).not.toHaveBeenCalled();
  });

  it("invokes onUnsubscribeResource when Unsubscribe is clicked", async () => {
    const user = userEvent.setup();
    const onUnsubscribeResource = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        onUnsubscribeResource={onUnsubscribeResource}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(onUnsubscribeResource).toHaveBeenCalledWith("file:///config.json");
  });

  it("renders empty section counts when collections are empty", () => {
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        resources={[]}
        templates={[]}
        subscriptions={[]}
      />,
    );
    expect(screen.getByText("URIs (0)")).toBeInTheDocument();
    expect(screen.getByText("Templates (0)")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions (0)")).toBeInTheDocument();
  });

  it("seeds the accordion to all-open when compact is false", () => {
    renderWithMantine(<ResourceControls {...baseProps} compact={false} />);
    // All three sections open → ListToggle reads "Collapse all".
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("seeds the accordion to all-closed when compact is true", () => {
    renderWithMantine(<ResourceControls {...baseProps} compact />);
    // All three sections closed → ListToggle reads "Expand all".
    expect(
      screen.getByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();
  });

  it("invokes onCompactChange with the new preference when the ListToggle is clicked", async () => {
    const user = userEvent.setup();
    const onCompactChange = vi.fn();
    renderWithMantine(
      <ControlledResourceControls
        compact={false}
        onCompactChange={onCompactChange}
      />,
    );
    // All sections start open → ListToggle reads "Collapse all"; clicking
    // it collapses everything and records compact=true.
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onCompactChange).toHaveBeenCalledWith(true);
    // Now collapsed → ListToggle reads "Expand all"; clicking re-expands
    // and records compact=false.
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onCompactChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps an empty section collapsed even when it's in openSections", () => {
    // All three sections requested open, but Subscriptions has no items: its
    // control must render collapsed (aria-expanded=false) so the chevron points
    // right, while the populated sections stay expanded (#1462).
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        subscriptions={[]}
        openSections={["resources", "templates", "subscriptions"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /URIs \(2\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /Templates \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /Subscriptions \(0\)/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("filters by resource title when title is set", async () => {
    const user = userEvent.setup();
    const resourcesWithTitle: Resource[] = [
      { name: "x", title: "Special Title", uri: "file:///x" },
      { name: "y", uri: "file:///y" },
    ];
    renderWithMantine(
      <ControlledResourceControls resources={resourcesWithTitle} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "special");
    expect(screen.getByText("URIs (1)")).toBeInTheDocument();
  });
});
