import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
  ReadResourceResult,
} from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { noopPagination } from "../../../test/fixtures/pagination";
import {
  ResourcesScreen,
  type ResourcesScreenProps,
  type ResourcesUiState,
} from "./ResourcesScreen";
import { EMPTY_RESOURCES_UI } from "../screenUiState";

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
  ui: EMPTY_RESOURCES_UI,
  onUiChange: vi.fn(),
  onRefreshList: vi.fn(),
  pagination: noopPagination,
  onReadResource: vi.fn(),
  onSubscribeResource: vi.fn(),
  onUnsubscribeResource: vi.fn(),
  compact: false,
  onCompactChange: vi.fn(),
};

const okResult: ReadResourceResult = {
  contents: [{ uri: "file:///x", text: "embedded contents" }],
};

// ResourcesScreen is controlled: the selected resource/template URIs, the
// originating-template marker, the sidebar search, and the accordion's open
// sections live in the parent (App) as one `ui` object so they persist across
// tab navigation (#1417). This host holds that state so clicking a
// resource/template, typing into the template form, reading, and closing drive
// the panel exactly as App owns it. Props passed in override defaults; the
// stateful `ui` wiring is applied last so callers can still observe activity via
// the rendered state.
function ControlledResourcesScreen(props: Partial<ResourcesScreenProps>) {
  const [ui, setUi] = useState<ResourcesUiState>({
    ...EMPTY_RESOURCES_UI,
    ...props.ui,
  });
  return (
    <ResourcesScreen
      {...baseProps}
      {...props}
      ui={ui}
      onUiChange={(next) => {
        setUi(next);
        props.onUiChange?.(next);
      }}
    />
  );
}

describe("ResourcesScreen", () => {
  it("renders empty preview state when nothing is selected", () => {
    renderWithMantine(<ResourcesScreen {...baseProps} />);
    expect(
      screen.getByText("Select a resource to preview"),
    ).toBeInTheDocument();
  });

  it("shows the read error alert when error and a resource is selected", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen
        readState={{ status: "error", error: "boom" }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Read Error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("falls back to default error when error message is missing", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen readState={{ status: "error" }} />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Failed to read resource")).toBeInTheDocument();
  });

  it("shows the loading state when reading", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen readState={{ status: "pending" }} />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByText("Reading resource...")).toBeInTheDocument();
  });

  it("renders the preview panel when readState has a result", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen
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

  it("toggles a section's open state through the lifted openSections handler", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(<ControlledResourcesScreen />);
    const urisHeader = screen.getByRole("button", { name: /URIs \(2\)/ });
    // Open by default (compact=false); clicking routes through ResourcesScreen's
    // onOpenSectionsChange → onUiChange and collapses it.
    expect(urisHeader).toHaveAttribute("aria-expanded", "true");
    await user.click(urisHeader);
    expect(urisHeader).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the template panel when a template is selected", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(<ControlledResourcesScreen />);
    // Templates section is open by default; select the template to open its form.
    await user.click(screen.getByText("files"));
    expect(
      screen.getByRole("button", { name: "Read Resource" }),
    ).toBeInTheDocument();
  });

  it("hides the template panel once the user reads the resource", async () => {
    const user = userEvent.setup({ delay: null });
    const onReadResource = vi.fn();
    renderWithMantine(
      <ControlledResourcesScreen onReadResource={onReadResource} />,
    );
    await user.click(screen.getByText("files"));
    await user.type(screen.getByLabelText("path"), "alpha");
    await user.click(screen.getByRole("button", { name: "Read Resource" }));
    expect(onReadResource).toHaveBeenCalledWith("file:///alpha");
    // After read, the template form is gone and the preview branch is active.
    expect(
      screen.queryByRole("button", { name: "Read Resource" }),
    ).not.toBeInTheDocument();
  });

  it("auto-reads when a resource is clicked in the sidebar", async () => {
    const user = userEvent.setup({ delay: null });
    const onReadResource = vi.fn();
    renderWithMantine(
      <ControlledResourcesScreen onReadResource={onReadResource} />,
    );
    await user.click(screen.getByText("x.txt"));
    expect(onReadResource).toHaveBeenCalledWith("file:///x");
  });

  it("forwards refresh and subscribe events from the preview panel", async () => {
    const user = userEvent.setup({ delay: null });
    const onReadResource = vi.fn();
    const onSubscribeResource = vi.fn();
    renderWithMantine(
      <ControlledResourcesScreen
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

  it("closing the preview returns to the originating template form", async () => {
    const user = userEvent.setup({ delay: null });
    const onReadResource = vi.fn();
    const templates: ResourceTemplate[] = [
      { uriTemplate: "file:///{path}", name: "files" },
    ];
    const { rerender } = renderWithMantine(
      <ControlledResourcesScreen
        templates={templates}
        onReadResource={onReadResource}
      />,
    );
    // Templates is open by default; select the template to open its form.
    await user.click(screen.getByText("files"));
    // Submit it — the screen calls onReadResource and remembers the
    // template URI for the close handler.
    await user.type(screen.getByLabelText("path"), "alpha");
    await user.click(screen.getByRole("button", { name: "Read Resource" }));
    expect(onReadResource).toHaveBeenCalledWith("file:///alpha");

    // Parent re-renders with the read result; the preview appears.
    rerender(
      <ControlledResourcesScreen
        templates={templates}
        onReadResource={onReadResource}
        readState={{
          status: "ok",
          uri: "file:///alpha",
          result: okResult,
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Read Resource" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    // Closing brings the template form back.
    expect(
      screen.getByRole("button", { name: "Read Resource" }),
    ).toBeInTheDocument();
  });

  it("closing the preview from the error state returns to the template form", async () => {
    const user = userEvent.setup({ delay: null });
    const templates: ResourceTemplate[] = [
      { uriTemplate: "demo://resource/dynamic/text/{id}", name: "Dynamic" },
    ];
    const { rerender } = renderWithMantine(
      <ControlledResourcesScreen templates={templates} />,
    );
    await user.click(screen.getByText("Dynamic"));
    await user.type(screen.getByLabelText("id"), "asdf");
    await user.click(screen.getByRole("button", { name: "Read Resource" }));

    // Server rejects the URI.
    rerender(
      <ControlledResourcesScreen
        templates={templates}
        readState={{
          status: "error",
          uri: "demo://resource/dynamic/text/asdf",
          error: "MCP error -32603: Unknown resource",
        }}
      />,
    );
    expect(screen.getByText("Read Error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    // The template form is restored so the user can fix their input.
    expect(
      screen.getByRole("button", { name: "Read Resource" }),
    ).toBeInTheDocument();
  });

  it("closing the preview for a plain resource returns to the empty state", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen
        readState={{
          status: "ok",
          uri: "file:///x",
          result: okResult,
        }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(
      screen.getByText("Select a resource to preview"),
    ).toBeInTheDocument();
  });

  it("invokes onUnsubscribeResource when already subscribed", async () => {
    const user = userEvent.setup({ delay: null });
    const onUnsubscribeResource = vi.fn();
    renderWithMantine(
      <ControlledResourcesScreen
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

  it("routes sidebar search text through onUiChange", async () => {
    const user = userEvent.setup({ delay: null });
    const onUiChange = vi.fn();
    renderWithMantine(<ControlledResourcesScreen onUiChange={onUiChange} />);
    await user.type(screen.getByPlaceholderText("Search..."), "y.txt");
    expect(onUiChange).toHaveBeenCalled();
    const last = onUiChange.mock.calls.at(-1)?.[0] as ResourcesUiState;
    expect(last.search).toBe("y.txt");
  });

  it("renders nothing in the preview when an ok state carries no result", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen
        // readResource is truthy (selected resource exists) but the ok
        // state has no `result`, so renderReadState falls through to null.
        readState={{ status: "ok", uri: "file:///x" }}
      />,
    );
    await user.click(screen.getByText("x.txt"));
    // Preview branch is active (readResource present) but nothing renders:
    // no error/loader and no preview content.
    expect(screen.queryByText("Read Error")).not.toBeInTheDocument();
    expect(screen.queryByText("Reading resource...")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Select a resource to preview"),
    ).not.toBeInTheDocument();
  });

  it("threads onCompleteArgument with a ref/resource envelope from the template form", async () => {
    const user = userEvent.setup({ delay: null });
    const onCompleteArgument = vi
      .fn<
        (
          ref:
            | { type: "ref/resource"; uri: string }
            | { type: "ref/prompt"; name: string },
          argName: string,
          value: string,
          context: Record<string, string>,
        ) => Promise<string[]>
      >()
      .mockResolvedValue([]);
    renderWithMantine(
      <ControlledResourcesScreen
        completionsSupported
        onCompleteArgument={onCompleteArgument}
      />,
    );
    await user.click(screen.getByText("files"));
    // Focusing the variable input fires an immediate completion request,
    // which routes through the screen's ref/resource wrapper.
    await user.click(screen.getByRole("textbox", { name: "path" }));
    expect(onCompleteArgument).toHaveBeenCalled();
    expect(onCompleteArgument.mock.calls[0][0]).toEqual({
      type: "ref/resource",
      uri: "file:///{path}",
    });
  });

  it("hides the Subscriptions section and Subscribe button when subscriptionsSupported is false", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ControlledResourcesScreen
        subscriptionsSupported={false}
        readState={{
          status: "ok",
          uri: "file:///x",
          result: okResult,
          isSubscribed: false,
        }}
      />,
    );
    // Sidebar Subscriptions accordion section is gone.
    expect(screen.queryByText(/Subscriptions/)).not.toBeInTheDocument();
    // Opening a resource preview shows Refresh but no Subscribe button.
    await user.click(screen.getByText("x.txt"));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Subscribe" }),
    ).not.toBeInTheDocument();
  });
});
