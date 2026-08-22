import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import {
  appSourceTitle,
  sameAppSource,
  type AppRenderSource,
} from "./appRenderSource";

const tool: Tool = {
  name: "cohort_app",
  title: "Cohort App",
  inputSchema: { type: "object" },
};
const other: Tool = { name: "other_app", inputSchema: { type: "object" } };

const toolSource: AppRenderSource = { kind: "tool", tool };
const resourceSource: AppRenderSource = {
  kind: "resource",
  resourceUri: "ui://demo/pick.html",
};

describe("appRenderSource (#1854)", () => {
  describe("sameAppSource", () => {
    it("is true for the identical object", () => {
      expect(sameAppSource(toolSource, toolSource)).toBe(true);
    });

    it("is true for a re-created wrapper around the same tool", () => {
      // The reason the comparison is not `===`: a caller writing the source
      // inline makes a new object each render, and rebuilding on that
      // double-loads the sandbox.
      expect(sameAppSource(toolSource, { kind: "tool", tool })).toBe(true);
    });

    it("is false when the Tool identity changes", () => {
      // Preserved from before the union existed: a re-listed tool rebuilds.
      expect(sameAppSource(toolSource, { kind: "tool", tool: other })).toBe(
        false,
      );
      expect(
        sameAppSource(toolSource, { kind: "tool", tool: { ...tool } }),
      ).toBe(false);
    });

    it("compares resource sources by URI and title", () => {
      expect(
        sameAppSource(resourceSource, {
          kind: "resource",
          resourceUri: "ui://demo/pick.html",
        }),
      ).toBe(true);
      expect(
        sameAppSource(resourceSource, {
          kind: "resource",
          resourceUri: "ui://demo/other.html",
        }),
      ).toBe(false);
      expect(
        sameAppSource(resourceSource, {
          kind: "resource",
          resourceUri: "ui://demo/pick.html",
          title: "Pick one",
        }),
      ).toBe(false);
    });

    it("is false across kinds", () => {
      expect(sameAppSource(toolSource, resourceSource)).toBe(false);
      expect(sameAppSource(resourceSource, toolSource)).toBe(false);
    });
  });

  describe("appSourceTitle", () => {
    it("prefers a tool's title, falling back to its name", () => {
      expect(appSourceTitle(toolSource)).toBe("Cohort App");
      expect(appSourceTitle({ kind: "tool", tool: other })).toBe("other_app");
    });

    it("prefers an explicit resource title, falling back to the URI", () => {
      expect(appSourceTitle(resourceSource)).toBe("ui://demo/pick.html");
      expect(
        appSourceTitle({ ...resourceSource, title: "Choose an option" }),
      ).toBe("Choose an option");
    });
  });
});
