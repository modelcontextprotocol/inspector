import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
} from "@modelcontextprotocol/client";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ResourceControls,
  type ResourceControlsProps,
} from "./ResourceControls";
import { noopPagination } from "../../../test/fixtures/pagination";

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
  pagination: noopPagination,
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
    expect(screen.getByRole("button", { name: /URIs \(2\)/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Templates \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /Subscriptions \(0\)/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("preserves an open-but-empty section's intent when toggling another section", async () => {
    // Subscriptions is open-in-intent but empty (excluded from the accordion's
    // value). Collapsing a populated section must not drop subscriptions from
    // the persisted intent, so it reopens once it has items again (#1462).
    const user = userEvent.setup();
    const onOpenSectionsChange = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        subscriptions={[]}
        openSections={["resources", "templates", "subscriptions"]}
        onOpenSectionsChange={onOpenSectionsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Templates \(1\)/ }));
    // Mantine emits ["resources"]; "subscriptions" is merged back in.
    expect(onOpenSectionsChange).toHaveBeenCalledWith(
      expect.arrayContaining(["resources", "subscriptions"]),
    );
    expect(onOpenSectionsChange.mock.calls[0][0]).not.toContain("templates");
  });

  it("hides the Subscriptions section when subscriptionsSupported is false", () => {
    renderWithMantine(
      <ResourceControls {...baseProps} subscriptionsSupported={false} />,
    );
    expect(screen.getByText("URIs (2)")).toBeInTheDocument();
    expect(screen.getByText("Templates (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Subscriptions/)).not.toBeInTheDocument();
  });

  it("shows the Subscriptions section by default (subscriptionsSupported omitted)", () => {
    renderWithMantine(<ResourceControls {...baseProps} />);
    expect(screen.getByText("Subscriptions (1)")).toBeInTheDocument();
  });

  it("reads 'Collapse all' with subscriptions hidden when the two visible sections are open", () => {
    // allSections drops "subscriptions", so the remaining two open sections
    // must still count as fully expanded — even if persisted openSections
    // still carries a stale "subscriptions" entry.
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        subscriptionsSupported={false}
        compact={false}
        openSections={["resources", "templates", "subscriptions"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("drops a stale 'subscriptions' entry from persisted state when subscriptions are unsupported", async () => {
    // A "subscriptions" value persisted from a prior subscription-capable
    // session must not be perpetually re-appended once the section is no longer
    // rendered — toggling a visible section should emit it out of the open set.
    const user = userEvent.setup();
    const onOpenSectionsChange = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        subscriptionsSupported={false}
        openSections={["resources", "templates", "subscriptions"]}
        onOpenSectionsChange={onOpenSectionsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Templates \(1\)/ }));
    expect(onOpenSectionsChange).toHaveBeenCalledTimes(1);
    expect(onOpenSectionsChange.mock.calls[0][0]).not.toContain(
      "subscriptions",
    );
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

  describe("modern listen-stream chrome (#1630)", () => {
    const activeAck = {
      active: true as const,
      status: "acknowledged" as const,
      honoredUris: ["file:///config.json"],
    };

    it("shows the stream badge in the section header on the modern era", () => {
      renderWithMantine(
        <ControlledResourceControls
          protocolEra="modern"
          subscriptionStreamState={activeAck}
        />,
      );
      // The labelled badge sits in the accordion header (next to the count).
      expect(screen.getByText("Listening")).toBeInTheDocument();
    });

    it("renders no stream chrome on the legacy era even when a stream is active", () => {
      renderWithMantine(
        <ControlledResourceControls subscriptionStreamState={activeAck} />,
      );
      expect(screen.queryByText("Listening")).not.toBeInTheDocument();
    });

    it("renders no stream chrome on the modern era when the stream is inactive", () => {
      renderWithMantine(
        <ControlledResourceControls
          protocolEra="modern"
          subscriptionStreamState={{
            active: false,
            status: "ended",
            honoredUris: [],
          }}
        />,
      );
      expect(
        screen.queryByText(/Listening|Stream ended/),
      ).not.toBeInTheDocument();
    });

    it("hides the stream badge when a search filters out all subscriptions", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ControlledResourceControls
          protocolEra="modern"
          subscriptionStreamState={activeAck}
        />,
      );
      expect(screen.getByText("Listening")).toBeInTheDocument();

      // A query matching none of the (live) subscriptions empties the section;
      // the badge hides with it rather than sitting next to "Subscriptions (0)".
      await user.type(
        screen.getByPlaceholderText("Search..."),
        "no-such-resource",
      );
      expect(screen.getByText("Subscriptions (0)")).toBeInTheDocument();
      expect(screen.queryByText("Listening")).not.toBeInTheDocument();
    });
  });
});
