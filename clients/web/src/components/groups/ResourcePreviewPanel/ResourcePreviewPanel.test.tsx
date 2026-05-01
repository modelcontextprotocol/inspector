import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  BlobResourceContents,
  Resource,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourcePreviewPanel } from "./ResourcePreviewPanel";

const textResource: Resource = {
  name: "config.json",
  uri: "file:///config.json",
};

const textContents: TextResourceContents[] = [
  {
    uri: "file:///config.json",
    mimeType: "application/json",
    text: '{"a":1}',
  },
];

const imageBlob: BlobResourceContents = {
  uri: "file:///x.png",
  mimeType: "image/png",
  blob: "abc",
};

const audioBlob: BlobResourceContents = {
  uri: "file:///x.wav",
  mimeType: "audio/wav",
  blob: "abc",
};

const otherBlob: BlobResourceContents = {
  uri: "file:///x.bin",
  mimeType: "application/octet-stream",
  blob: "abc",
};

const blobNoMime: BlobResourceContents = {
  uri: "file:///x",
  blob: "abc",
};

const baseProps = {
  resource: textResource,
  contents: textContents,
  isSubscribed: false,
  onRefresh: vi.fn(),
  onSubscribe: vi.fn(),
  onUnsubscribe: vi.fn(),
};

describe("ResourcePreviewPanel", () => {
  it("renders the resource title and URI", () => {
    renderWithMantine(<ResourcePreviewPanel {...baseProps} />);
    expect(screen.getByText("Resource")).toBeInTheDocument();
    expect(screen.getByText("file:///config.json")).toBeInTheDocument();
  });

  it("renders the mimeType when contents has at most one item", () => {
    renderWithMantine(<ResourcePreviewPanel {...baseProps} />);
    expect(screen.getByText("application/json")).toBeInTheDocument();
  });

  it("does not render mimeType when there are multiple content items", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        contents={[textContents[0], textContents[0]]}
      />,
    );
    expect(screen.queryByText("application/json")).not.toBeInTheDocument();
  });

  it("renders the lastUpdated timestamp when provided", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        lastUpdated={new Date("2026-03-17T10:30:00Z")}
      />,
    );
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();
  });

  it("renders Subscribe button when not subscribed and triggers onSubscribe", async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} onSubscribe={onSubscribe} />,
    );
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders Unsubscribe button when subscribed and triggers onUnsubscribe", async () => {
    const user = userEvent.setup();
    const onUnsubscribe = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        isSubscribed
        onUnsubscribe={onUnsubscribe}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("invokes onRefresh when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} onRefresh={onRefresh} />,
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders annotation badges when present", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{
          ...textResource,
          annotations: { audience: ["user"], priority: 0.8 },
        }}
      />,
    );
    expect(screen.getByText("audience: user")).toBeInTheDocument();
    expect(screen.getByText("priority: high")).toBeInTheDocument();
  });

  it("renders an image content viewer for image blobs", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "img", uri: "file:///x.png" }}
        contents={[imageBlob]}
      />,
    );
    const img = screen
      .getAllByRole("img")
      .find((el) => el.getAttribute("src")?.startsWith("data:image/png"));
    expect(img).toBeDefined();
  });

  it("renders an audio element for audio blobs", () => {
    const { container } = renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "snd", uri: "file:///x.wav" }}
        contents={[audioBlob]}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
  });

  it("renders a textual unsupported message for non-image, non-audio blobs", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "bin", uri: "file:///x.bin" }}
        contents={[otherBlob]}
      />,
    );
    expect(
      screen.getByText(
        "[Binary content (application/octet-stream) — preview not supported]",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to application/octet-stream when blob has no mimeType", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "bin", uri: "file:///x" }}
        contents={[blobNoMime]}
      />,
    );
    expect(screen.getByText("application/octet-stream")).toBeInTheDocument();
  });

  it("falls back to resource.mimeType when contents is empty", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{
          name: "x",
          uri: "file:///x",
          mimeType: "text/markdown",
        }}
        contents={[]}
      />,
    );
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
  });
});
