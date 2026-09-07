import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SCHEMA_FINDINGS_EXPANDED_KEY,
  useSchemaFindingsExpanded,
} from "./useSchemaFindingsExpanded";

describe("useSchemaFindingsExpanded", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  // Collapsed by default is the whole fix (#2205): the wall of findings must
  // not sit between the caller and the argument form on a fresh install.
  it("starts collapsed when nothing is stored", () => {
    const { result } = renderHook(() => useSchemaFindingsExpanded());
    expect(result.current[0]).toBe(false);
  });

  it("reads a stored preference synchronously on first render", () => {
    window.localStorage.setItem(SCHEMA_FINDINGS_EXPANDED_KEY, "true");
    const { result } = renderHook(() => useSchemaFindingsExpanded());
    expect(result.current[0]).toBe(true);
  });

  it("reads a stored collapsed preference back as collapsed", () => {
    window.localStorage.setItem(SCHEMA_FINDINGS_EXPANDED_KEY, "false");
    const { result } = renderHook(() => useSchemaFindingsExpanded());
    expect(result.current[0]).toBe(false);
  });

  // A manual edit or a value written by another build must land on the default
  // rather than silently coercing to `false` — the same clamp-on-read shape the
  // sort/compact preferences in InspectorView use.
  it("clamps an unrecognized stored value back to the default", () => {
    window.localStorage.setItem(SCHEMA_FINDINGS_EXPANDED_KEY, "yes please");
    const { result } = renderHook(() => useSchemaFindingsExpanded());
    expect(result.current[0]).toBe(false);
  });

  it("persists the choice as a human-readable boolean", () => {
    const { result } = renderHook(() => useSchemaFindingsExpanded());

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(SCHEMA_FINDINGS_EXPANDED_KEY)).toBe(
      "true",
    );

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SCHEMA_FINDINGS_EXPANDED_KEY)).toBe(
      "false",
    );
  });

  // Global, not per tool: a second consumer mounted later sees the choice the
  // first one made, which is what makes the preference survive a tool switch.
  it("hands the stored choice to a later consumer", () => {
    const { result: first } = renderHook(() => useSchemaFindingsExpanded());
    act(() => {
      first.current[1](true);
    });

    const { result: second } = renderHook(() => useSchemaFindingsExpanded());
    expect(second.current[0]).toBe(true);
  });
});
