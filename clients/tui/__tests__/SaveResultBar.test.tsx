import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "./helpers/renderTui";
import { SaveResultBar } from "../src/components/SaveResultBar.js";

describe("SaveResultBar (#2571)", () => {
  it("shows the prompt with its format, path and key hints", () => {
    const { lastFrame } = render(
      <SaveResultBar
        prompt={{ path: "alpha-result.json", format: "json", edited: false }}
        status={{ ok: true, message: "hidden while prompting" }}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Save as json: alpha-result.json");
    expect(frame).toContain("Enter to save, Tab to switch json/raw, ESC");
    expect(frame).not.toContain("hidden while prompting");
  });

  it("shows a confirmation once the prompt closes", () => {
    const { lastFrame } = render(
      <SaveResultBar
        prompt={null}
        status={{ ok: true, message: "Saved json result to /tmp/a.json" }}
      />,
    );
    expect(lastFrame()).toContain("Saved json result to /tmp/a.json");
  });

  it("shows a failure message", () => {
    const { lastFrame } = render(
      <SaveResultBar
        prompt={null}
        status={{ ok: false, message: "Could not write /nope/a.json" }}
      />,
    );
    expect(lastFrame()).toContain("Could not write /nope/a.json");
  });

  it("renders nothing when idle", () => {
    const { lastFrame } = render(<SaveResultBar prompt={null} status={null} />);
    expect(lastFrame()).toBe("");
  });
});
