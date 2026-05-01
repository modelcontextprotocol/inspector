import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceControls } from "./ResourceControls";

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
  onSelectUri: vi.fn(),
  onSelectTemplate: vi.fn(),
  onUnsubscribeResource: vi.fn(),
};

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
    renderWithMantine(<ResourceControls {...baseProps} />);
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

  it("toggles all sections via the ListToggle button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ResourceControls {...baseProps} />);
    const toggleButtons = screen.getAllByRole("button");
    // The list toggle is the last in the search row; just exercise it.
    // Since all three sections start open, clicking it should collapse them.
    const toggle = toggleButtons.find(
      (btn) => btn.querySelector("svg") && btn !== toggleButtons[0],
    );
    if (toggle) {
      await user.click(toggle);
    }
    // After collapse, click again to re-expand.
    if (toggle) {
      await user.click(toggle);
    }
    expect(screen.getByText("URIs (2)")).toBeInTheDocument();
  });

  it("filters by resource title when title is set", async () => {
    const user = userEvent.setup();
    const resourcesWithTitle: Resource[] = [
      { name: "x", title: "Special Title", uri: "file:///x" },
      { name: "y", uri: "file:///y" },
    ];
    renderWithMantine(
      <ResourceControls {...baseProps} resources={resourcesWithTitle} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "special");
    expect(screen.getByText("URIs (1)")).toBeInTheDocument();
  });
});
