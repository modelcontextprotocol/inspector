import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplate,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourcesScreen } from "./ResourcesScreen";

const resources: Resource[] = [
  { uri: "file:///x", name: "x.txt" },
  { uri: "file:///y", name: "y.txt" },
];

const templates: ResourceTemplate[] = [
  { uriTemplate: "file:///{path}", name: "files" },
];

const baseProps = {
  resources,
  templates,
  subscriptions: [],
  listChanged: false,
  onRefreshList: vi.fn(),
  onReadResource: vi.fn(),
  onSubscribeResource: vi.fn(),
  onUnsubscribeResource: vi.fn(),
};

const okResult: ReadResourceResult = {
  contents: [{ uri: "file:///x", text: "embedded contents" }],
};

describe("ResourcesScreen", () => {
  it("renders empty preview state when nothing is selected", () => {
    renderWithMantine(<ResourcesScreen {...baseProps} />);
    expect(
      screen.getByText("Select a resource to preview"),
    ).toBeInTheDocument();
  });

  it("shows the read error alert when error and a resource is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourcesScreen
        {...baseProps}
        readState={{ status: "error", error: "boom" }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Read Error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("falls back to default error when error message is missing", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourcesScreen {...baseProps} readState={{ status: "error" }} />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Failed to read resource")).toBeInTheDocument();
  });

  it("shows the loading state when reading", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourcesScreen {...baseProps} readState={{ status: "pending" }} />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Reading resource...")).toBeInTheDocument();
  });

  it("renders the preview panel when readState has a result", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourcesScreen
        {...baseProps}
        readState={{
          status: "ok",
          uri: "file:///x",
          result: okResult,
        }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("embedded contents")).toBeInTheDocument();
  });

  it("synthesizes a Resource for template-expanded URIs not in the list", () => {
    renderWithMantine(
      <ResourcesScreen
        {...baseProps}
        resources={[]}
        readState={{
          status: "ok",
          uri: "file:///synthetic",
          result: { contents: [{ uri: "file:///synthetic", text: "syn" }] },
        }}
      />,
    );
    expect(
      screen.getByText("Select a resource to preview"),
    ).toBeInTheDocument();
  });

  it("renders the template panel when a template is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ResourcesScreen {...baseProps} />);
    await user.click(screen.getByText("Templates (1)"));
    await user.click(screen.getByText("files"));
    expect(
      screen.getByText("Enter a URI and click Read to preview"),
    ).toBeInTheDocument();
  });

  it("renders empty state when a resource is selected but no readState", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ResourcesScreen {...baseProps} />);
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Click to read this resource")).toBeInTheDocument();
  });

  it("forwards refresh and subscribe events from the preview panel", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn();
    const onSubscribeResource = vi.fn();
    renderWithMantine(
      <ResourcesScreen
        {...baseProps}
        onReadResource={onReadResource}
        onSubscribeResource={onSubscribeResource}
        readState={{
          status: "ok",
          uri: "file:///x",
          result: okResult,
          isSubscribed: false,
        }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onReadResource).toHaveBeenCalledWith("file:///x");
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onSubscribeResource).toHaveBeenCalledWith("file:///x");
  });

  it("invokes onUnsubscribeResource when already subscribed", async () => {
    const user = userEvent.setup();
    const onUnsubscribeResource = vi.fn();
    renderWithMantine(
      <ResourcesScreen
        {...baseProps}
        onUnsubscribeResource={onUnsubscribeResource}
        readState={{
          status: "ok",
          uri: "file:///x",
          result: okResult,
          isSubscribed: true,
        }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(onUnsubscribeResource).toHaveBeenCalledWith("file:///x");
  });
});
