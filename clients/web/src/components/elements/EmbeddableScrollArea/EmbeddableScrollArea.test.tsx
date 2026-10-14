import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EmbeddableScrollArea } from "./EmbeddableScrollArea";

describe("EmbeddableScrollArea", () => {
  it("renders its children full-size", () => {
    renderWithMantine(
      <EmbeddableScrollArea embedded={false} viewportRef={createRef()}>
        <div>full-size content</div>
      </EmbeddableScrollArea>,
    );
    expect(screen.getByText("full-size content")).toBeInTheDocument();
  });

  it("renders its children when embedded", () => {
    renderWithMantine(
      <EmbeddableScrollArea embedded={true} viewportRef={createRef()}>
        <div>embedded content</div>
      </EmbeddableScrollArea>,
    );
    expect(screen.getByText("embedded content")).toBeInTheDocument();
  });

  it("attaches the viewport ref to the scroll viewport", () => {
    const ref = createRef<HTMLDivElement>();
    renderWithMantine(
      <EmbeddableScrollArea embedded={false} viewportRef={ref}>
        <div>content</div>
      </EmbeddableScrollArea>,
    );
    expect(ref.current).toBeInstanceOf(HTMLElement);
  });

  it("always constrains the content width when embedded (#2675)", () => {
    renderWithMantine(
      <EmbeddableScrollArea embedded={true} viewportRef={createRef()}>
        <div>sidebar content</div>
      </EmbeddableScrollArea>,
    );
    // No opt-in: every monitoring-sidebar panel gets the constraint, so a
    // long non-wrapping row can't widen the list past the column.
    const content = document.querySelector(".mantine-ScrollArea-content");
    expect((content as HTMLElement).style.minWidth).toBe("0");
  });

  it("leaves the content width unconstrained full-size by default", () => {
    renderWithMantine(
      <EmbeddableScrollArea embedded={false} viewportRef={createRef()}>
        <div>full-size content</div>
      </EmbeddableScrollArea>,
    );
    const content = document.querySelector(".mantine-ScrollArea-content");
    expect((content as HTMLElement).style.minWidth).toBe("");
  });

  it.each([false, true])(
    "constrains the content width when asked (embedded=%s)",
    (embedded) => {
      const ref = createRef<HTMLDivElement>();
      renderWithMantine(
        <EmbeddableScrollArea
          embedded={embedded}
          viewportRef={ref}
          constrainContentWidth
        >
          <div>constrained content</div>
        </EmbeddableScrollArea>,
      );
      expect(screen.getByText("constrained content")).toBeInTheDocument();
      // The Mantine ScrollArea `content` slot has its default
      // `min-width: max-content` relaxed to 0 so a long non-wrapping row
      // (e.g. a network URL) can't stretch the list past its viewport (#1623).
      const content = document.querySelector(".mantine-ScrollArea-content");
      expect(content).not.toBeNull();
      expect((content as HTMLElement).style.minWidth).toBe("0");
    },
  );
});
