import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROTOCOL_ERA,
  MODERN_PROTOCOL_VERSION,
  eraToVersionNegotiation,
} from "@inspector/core/mcp/types.js";

describe("eraToVersionNegotiation", () => {
  it("maps legacy to the legacy mode", () => {
    expect(eraToVersionNegotiation("legacy")).toEqual({ mode: "legacy" });
  });

  it("maps auto to the probing mode", () => {
    expect(eraToVersionNegotiation("auto")).toEqual({ mode: "auto" });
  });

  it("maps modern to a pin at the modern protocol version", () => {
    expect(eraToVersionNegotiation("modern")).toEqual({
      mode: { pin: MODERN_PROTOCOL_VERSION },
    });
  });

  it("defaults to the legacy era", () => {
    expect(DEFAULT_PROTOCOL_ERA).toBe("legacy");
    expect(eraToVersionNegotiation(DEFAULT_PROTOCOL_ERA)).toEqual({
      mode: "legacy",
    });
  });
});
