import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
} from "@modelcontextprotocol/client";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE } from "@inspector/core/mcp/subscriptionAck.js";
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

    // A badge tooltip is not enough for this one: the server broke the listen
    // contract and the user has to be told without hovering (#2097).
    it("spells out a never-acknowledged close in the panel", () => {
      renderWithMantine(
        <ControlledResourceControls
          protocolEra="modern"
          subscriptionStreamState={{
            active: true,
            status: "never-acknowledged",
            honoredUris: [],
          }}
        />,
      );
      expect(screen.getByText("Not acknowledged")).toBeInTheDocument();
      expect(
        screen.getByText(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE),
      ).toBeInTheDocument();
    });

    it("shows no such notice while the stream is healthy", () => {
      renderWithMantine(
        <ControlledResourceControls
          protocolEra="modern"
          subscriptionStreamState={activeAck}
        />,
      );
      expect(
        screen.queryByText(NEVER_ACKNOWLEDGED_SUBSCRIPTION_MESSAGE),
      ).not.toBeInTheDocument();
    });
  });

  // A failed load is rendered above the list instead of leaving the panel
  // empty, which is indistinguishable from a server that has none (#1953).
  it("renders a failed load above the list and retries via onRefreshList", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <ResourceControls
        {...baseProps}
        loadError={new Error("codec said no")}
        onRefreshList={onRefreshList}
      />,
    );

    expect(screen.getByText("Couldn't load resources")).toBeInTheDocument();
    expect(screen.getByText("codec said no")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("renders no load error by default", () => {
    renderWithMantine(<ResourceControls {...baseProps} />);
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });

  // Nothing in the protocol makes `resources/list` URIs unique, and the store
  // does not dedupe them either — `ManagedListState.applyItems` replaces the
  // list wholesale, so a repeat is what the server actually sent. Keying a row
  // on the URI alone therefore collides, which React warns about on every
  // render and which lets a filtered-out row survive reconciliation (#2206).
  describe("duplicate identifiers (#2206)", () => {
    const duplicateUriResources: Resource[] = [
      { name: "app", title: "App First", uri: "ui://hello-world/app.html" },
      { name: "notes", title: "Notes", uri: "file:///notes.md" },
      { name: "app", title: "App Second", uri: "ui://hello-world/app.html" },
    ];

    const duplicateTemplates: ResourceTemplate[] = [
      { name: "profile", title: "Profile First", uriTemplate: "file:///{id}" },
      { name: "logs", title: "Logs", uriTemplate: "log:///{day}" },
      { name: "profile", title: "Profile Second", uriTemplate: "file:///{id}" },
    ];

    // Same URI, different names — the shape a search can tell apart. The rows
    // display the last URI segment, so assertions count rows rather than text.
    const duplicateSubscriptions: InspectorResourceSubscription[] = [
      {
        resource: { name: "alpha", uri: "ui://hello-world/app.html" },
        lastUpdated: new Date("2026-03-17T10:30:00Z"),
      },
      {
        resource: { name: "beta", uri: "file:///notes.md" },
        lastUpdated: new Date("2026-03-17T10:31:00Z"),
      },
      {
        resource: { name: "gamma", uri: "ui://hello-world/app.html" },
        lastUpdated: new Date("2026-03-17T10:32:00Z"),
      },
    ];

    // The console warning was the reported symptom, so assert on it directly:
    // React only emits it when two siblings share a key.
    it("renders repeated URIs without a React key collision", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        renderWithMantine(
          <ResourceControls
            {...baseProps}
            resources={duplicateUriResources}
            templates={duplicateTemplates}
            subscriptions={duplicateSubscriptions}
          />,
        );
        const messages = consoleError.mock.calls.map((call) =>
          call.map(String).join(" "),
        );
        expect(
          messages.filter((message) => message.includes("same key")),
        ).toEqual([]);
        // Every entry the server sent is still on screen, which is the other
        // half of what the collision put at risk.
        expect(screen.getByText("App First")).toBeInTheDocument();
        expect(screen.getByText("App Second")).toBeInTheDocument();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("removes every non-matching row when resource URIs repeat", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ControlledResourceControls resources={duplicateUriResources} />,
      );

      await user.type(screen.getByPlaceholderText("Search..."), "notes");

      expect(screen.getByText("Notes")).toBeInTheDocument();
      // Both copies are orphaned by the collision on the broken build; the
      // second is the one React reuses rather than unmounting.
      expect(screen.queryByText("App First")).not.toBeInTheDocument();
      expect(screen.queryByText("App Second")).not.toBeInTheDocument();
    });

    it("removes every non-matching row when uriTemplates repeat", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ControlledResourceControls
          resources={[]}
          subscriptions={[]}
          templates={duplicateTemplates}
        />,
      );

      await user.type(screen.getByPlaceholderText("Search..."), "logs");

      expect(screen.getByText("Logs")).toBeInTheDocument();
      expect(screen.queryByText("Profile First")).not.toBeInTheDocument();
      expect(screen.queryByText("Profile Second")).not.toBeInTheDocument();
    });

    it("renders one row per subscription when their URIs repeat", () => {
      renderWithMantine(
        <ResourceControls
          {...baseProps}
          resources={[]}
          templates={[]}
          subscriptions={duplicateSubscriptions}
        />,
      );
      expect(screen.getByText("Subscriptions (3)")).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: "Unsubscribe" }),
      ).toHaveLength(3);
    });

    it("removes every non-matching row when subscription URIs repeat", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ControlledResourceControls
          resources={[]}
          templates={[]}
          subscriptions={duplicateSubscriptions}
        />,
      );

      await user.type(screen.getByPlaceholderText("Search..."), "beta");

      expect(screen.getByText("Subscriptions (1)")).toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: "Unsubscribe" }),
      ).toHaveLength(1);
    });
  });
});
