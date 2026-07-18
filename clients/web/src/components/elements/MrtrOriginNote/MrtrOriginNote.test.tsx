import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MrtrOriginNote } from "./MrtrOriginNote";

describe("MrtrOriginNote", () => {
  it("renders the MRTR note for a modern input-required round", () => {
    renderWithMantine(<MrtrOriginNote origin="input-required" />);
    expect(screen.getByText("input_required")).toBeInTheDocument();
    expect(screen.getByText(/sent back as a retry/i)).toBeInTheDocument();
  });

  it("renders nothing for a legacy server request", () => {
    renderWithMantine(<MrtrOriginNote origin="server-request" />);
    expect(screen.queryByText("input_required")).not.toBeInTheDocument();
    expect(screen.queryByText(/sent back as a retry/i)).not.toBeInTheDocument();
  });

  it("defaults to rendering nothing when origin is omitted", () => {
    renderWithMantine(<MrtrOriginNote />);
    expect(screen.queryByText("input_required")).not.toBeInTheDocument();
    expect(screen.queryByText(/sent back as a retry/i)).not.toBeInTheDocument();
  });
});
