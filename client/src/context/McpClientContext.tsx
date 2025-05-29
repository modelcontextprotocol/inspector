import { createContext, useContext } from "react";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export const McpClientContext = createContext<Client | null>(null);

export const useMcpClient = () => useContext(McpClientContext);
