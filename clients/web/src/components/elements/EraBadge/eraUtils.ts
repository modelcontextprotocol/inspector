import type { ProtocolEra } from "@modelcontextprotocol/client";

// The SDK reports an era for every connected server, including a plain legacy
// connect (`"legacy"`); it's `undefined` only when not connected. Anything other
// than `"modern"` is the legacy era. IMPORTANT: this reflects the *negotiated*
// connection era — it must be fed from connection state, never inferred from
// individual message frames (the modern probe carries a `_meta` envelope before
// the era is known; spec §8.3).
export function isModernEra(era: ProtocolEra | undefined): boolean {
  return era === "modern";
}

export function formatEra(era: ProtocolEra | undefined): string {
  return isModernEra(era) ? "Modern" : "Legacy";
}
