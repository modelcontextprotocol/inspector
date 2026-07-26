/**
 * Tests for the custom-headers value helpers: constructing headers, filtering
 * enabled/non-blank ones, converting to/from a plain record, and the legacy
 * bearer-token migration.
 */

import { describe, it, expect } from "vitest";
import {
  createEmptyHeader,
  createHeaderFromBearerToken,
  getEnabledHeaders,
  headersToRecord,
  recordToHeaders,
  migrateFromLegacyAuth,
  type CustomHeaders,
} from "./customHeaders";

describe("createEmptyHeader", () => {
  it("returns an enabled header with blank name and value", () => {
    expect(createEmptyHeader()).toEqual({
      name: "",
      value: "",
      enabled: true,
    });
  });
});

describe("createHeaderFromBearerToken", () => {
  it("defaults to an Authorization: Bearer header when no name is given", () => {
    expect(createHeaderFromBearerToken("abc")).toEqual({
      name: "Authorization",
      value: "Bearer abc",
      enabled: true,
    });
  });

  it("prefixes Bearer when the header name is Authorization (any case)", () => {
    expect(createHeaderFromBearerToken("abc", "authorization")).toEqual({
      name: "authorization",
      value: "Bearer abc",
      enabled: true,
    });
  });

  it("uses the raw token for non-Authorization header names", () => {
    expect(createHeaderFromBearerToken("abc", "X-Api-Key")).toEqual({
      name: "X-Api-Key",
      value: "abc",
      enabled: true,
    });
  });
});

describe("getEnabledHeaders", () => {
  it("keeps only enabled headers with non-blank name and value", () => {
    const headers: CustomHeaders = [
      { name: "A", value: "1", enabled: true },
      { name: "B", value: "2", enabled: false },
      { name: "", value: "3", enabled: true },
      { name: "C", value: "  ", enabled: true },
    ];
    expect(getEnabledHeaders(headers)).toEqual([
      { name: "A", value: "1", enabled: true },
    ]);
  });
});

describe("headersToRecord", () => {
  it("trims names/values and drops disabled or blank entries", () => {
    const headers: CustomHeaders = [
      { name: " X-One ", value: " a ", enabled: true },
      { name: "X-Two", value: "b", enabled: false },
    ];
    expect(headersToRecord(headers)).toEqual({ "X-One": "a" });
  });
});

describe("recordToHeaders", () => {
  it("maps each record entry to an enabled header", () => {
    expect(recordToHeaders({ "X-A": "1", "X-B": "2" })).toEqual([
      { name: "X-A", value: "1", enabled: true },
      { name: "X-B", value: "2", enabled: true },
    ]);
  });
});

describe("migrateFromLegacyAuth", () => {
  it("returns a single header for a bearer token", () => {
    expect(migrateFromLegacyAuth("abc", "X-Api-Key")).toEqual([
      { name: "X-Api-Key", value: "abc", enabled: true },
    ]);
  });

  it("returns an empty list when there is no bearer token", () => {
    expect(migrateFromLegacyAuth()).toEqual([]);
    expect(migrateFromLegacyAuth("")).toEqual([]);
  });
});
