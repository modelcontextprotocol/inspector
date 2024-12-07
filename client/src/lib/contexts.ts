import { createContext, useContext } from "react";
import { ServerCapabilitiesSchema } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;

export const CapabilityContext = createContext<ServerCapabilities | null>(null);

export function useServerCapability(capability: keyof ServerCapabilities): boolean {
  const capabilities = useContext(CapabilityContext);
  return !!capabilities?.[capability];
}
