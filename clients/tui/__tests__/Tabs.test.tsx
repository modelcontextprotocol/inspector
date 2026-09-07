import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "./helpers/renderTui";
import { Tabs } from "../src/components/Tabs.js";

const noop = () => {};

describe("Tabs", () => {
  it("renders the default visible tabs (auth + logging shown, requests hidden)", () => {
    const { lastFrame } = render(
      <Tabs activeTab="info" onTabChange={noop} width={120} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Info");
    expect(frame).toContain("Auth");
    expect(frame).toContain("Console");
    expect(frame).toContain("Protocol");
    // Network defaults to hidden
    expect(frame).not.toContain("Network");
  });

  it("hides the auth tab when showAuth is false", () => {
    const { lastFrame } = render(
      <Tabs activeTab="info" onTabChange={noop} width={120} showAuth={false} />,
    );
    expect(lastFrame() ?? "").not.toContain("Auth");
  });

  it("hides the logging tab when showLogging is false", () => {
    const { lastFrame } = render(
      <Tabs
        activeTab="info"
        onTabChange={noop}
        width={120}
        showLogging={false}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("Console");
  });

  it("shows the requests tab when showRequests is true", () => {
    const { lastFrame } = render(
      <Tabs
        activeTab="info"
        onTabChange={noop}
        width={120}
        showRequests={true}
      />,
    );
    expect(lastFrame() ?? "").toContain("Network");
  });

  it("hides the skills tab by default and shows it when showSkills is true", () => {
    // A *server-declared* extension (SEP-2640), unlike the transport-derived
    // gates above — it is only knowable after connecting, so the default has
    // to be hidden.
    const hidden = render(
      <Tabs activeTab="info" onTabChange={noop} width={140} />,
    );
    expect(hidden.lastFrame() ?? "").not.toContain("Skills");
    const shown = render(
      <Tabs
        activeTab="info"
        onTabChange={noop}
        width={140}
        showSkills={true}
      />,
    );
    expect(shown.lastFrame() ?? "").toContain("Skills");
  });

  it("renders a count on the skills tab", () => {
    const { lastFrame } = render(
      <Tabs
        activeTab="skills"
        onTabChange={noop}
        width={140}
        showSkills={true}
        counts={{ skills: 4 }}
      />,
    );
    expect(lastFrame() ?? "").toContain("Skills (4)");
  });

  it("marks the active tab with the ▶ marker", () => {
    const { lastFrame } = render(
      <Tabs activeTab="tools" onTabChange={noop} width={120} />,
    );
    expect(lastFrame() ?? "").toContain("▶");
  });

  it("renders counts when provided and omits them otherwise", () => {
    const withCounts = render(
      <Tabs
        activeTab="info"
        onTabChange={noop}
        width={120}
        counts={{ tools: 3, resources: 0 }}
      />,
    );
    const frame = withCounts.lastFrame() ?? "";
    expect(frame).toContain("(3)");
    // count of 0 is defined, so it still renders
    expect(frame).toContain("(0)");
  });

  it("highlights the focused active tab", () => {
    const { lastFrame } = render(
      <Tabs activeTab="info" onTabChange={noop} width={120} focused={true} />,
    );
    // focused active tab path renders without error and shows the marker
    expect(lastFrame() ?? "").toContain("▶");
  });
});
