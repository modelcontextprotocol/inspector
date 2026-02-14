import { InspectorClient } from "../mcp/index.js";
import type { ConnectionStatus, StderrLogEntry, MessageEntry, FetchRequestEntry } from "../mcp/index.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
export interface UseInspectorClientResult {
    status: ConnectionStatus;
    messages: MessageEntry[];
    stderrLogs: StderrLogEntry[];
    fetchRequests: FetchRequestEntry[];
    tools: any[];
    resources: any[];
    resourceTemplates: any[];
    prompts: any[];
    capabilities?: ServerCapabilities;
    serverInfo?: Implementation;
    instructions?: string;
    client: Client | null;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
}
/**
 * React hook that subscribes to InspectorClient events and provides reactive state
 */
export declare function useInspectorClient(inspectorClient: InspectorClient | null): UseInspectorClientResult;
//# sourceMappingURL=useInspectorClient.d.ts.map