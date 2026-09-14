import { describe, it, expect } from "vitest";
import { Code } from "@mantine/core";
import { renderWithMantine } from "../test/renderWithMantine";

// `ThemeCode.extend` is applied transitively wherever a Code renders, but no
// single component exercises every branch of its styles callback. Same reason
// as `Paper.test.tsx` (#1787 brought theme/** under the coverage gate).
//
// The load-bearing assertion here is the `wrapping` / `wrapping-plain` split
// (#2328): `wrapping-plain` exists so Connection Info can drop the inset
// surface behind a label/value pair *without* changing `wrapping`, which
// ElicitationUrlPanel, ListLoadError, MalformedItemsWarning and the CSV
// fallback all rely on to separate a raw value from the prose around it.

describe("ThemeCode variants", () => {
  it("renders the default variant", () => {
    const { getByText } = renderWithMantine(<Code>default</Code>);
    expect(getByText("default")).toBeTruthy();
  });

  it("wraps long values in both wrapping variants", () => {
    for (const variant of ["wrapping", "wrapping-plain"] as const) {
      const { getByText } = renderWithMantine(
        <Code variant={variant}>{variant}</Code>,
      );
      const style = getByText(variant).style;
      expect(style.wordBreak).toBe("break-all");
      expect(style.whiteSpace).toBe("pre-wrap");
    }
  });

  it("strips the inset surface for wrapping-plain only", () => {
    const { getByText: getPlain } = renderWithMantine(
      <Code variant="wrapping-plain">plain</Code>,
    );
    expect(getPlain("plain").style.backgroundColor).toBe("transparent");
    expect(getPlain("plain").style.padding).toBe("0px");

    // The guard that makes this change safe: `wrapping` keeps its surface, so
    // every other consumer of it is untouched.
    const { getByText: getInset } = renderWithMantine(
      <Code variant="wrapping">inset</Code>,
    );
    expect(getInset("inset").style.backgroundColor).not.toBe("transparent");
    expect(getInset("inset").style.padding).not.toBe("0px");
  });

  it("clips instead of wrapping for the nowrap variant", () => {
    const { getByText } = renderWithMantine(<Code variant="nowrap">n</Code>);
    const style = getByText("n").style;
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).toBe("hidden");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("drops the margin on a block Code", () => {
    const { getByText } = renderWithMantine(<Code block>b</Code>);
    expect(getByText("b").style.margin).toBe("0px");
  });
});
