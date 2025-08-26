import { useCallback } from "react";
import { MultiServerApi } from "../services/multiServerApi";
import { multiServerHistoryStore } from "../stores/multiServerHistoryStore";

/**
 * Custom hook for making MCP requests in multi-server mode using HTTP API
 */
export function useMultiServerMCP(serverId: string) {
  const makeRequest = useCallback(
    async (request: any, _schema: any) => {
      const { method, params } = request;

      // Get server name for history logging
      const serverName =
        multiServerHistoryStore
          .getServerHistoryData()
          .find((data) => data.serverId === serverId)?.serverName ||
        `Server ${serverId}`;

      try {
        let response;
        let finalResult;

        // Log the request to history
        const requestString = JSON.stringify(request);

        switch (method) {
          case "resources/list":
            response = await MultiServerApi.listResources(
              serverId,
              params?.cursor,
            );
            // The API returns { resources: [...] }, but we need to match the schema
            finalResult = {
              resources: response.resources || [],
              nextCursor: response.nextCursor,
            };
            break;

          case "resources/templates/list":
            response = await MultiServerApi.listResourceTemplates(
              serverId,
              params?.cursor,
            );
            finalResult = response.result || response;
            break;

          case "resources/read":
            response = await MultiServerApi.readResource(serverId, params.uri);
            finalResult = response.result || response;
            break;

          case "resources/subscribe":
            response = await MultiServerApi.subscribeToResource(
              serverId,
              params.uri,
            );
            finalResult = response.result || {};
            break;

          case "resources/unsubscribe":
            response = await MultiServerApi.unsubscribeFromResource(
              serverId,
              params.uri,
            );
            finalResult = response.result || {};
            break;

          case "tools/list":
            response = await MultiServerApi.listTools(serverId, params?.cursor);
            // The API returns { tools: [...] }, but we need to match the schema
            finalResult = {
              tools: response.tools || [],
              nextCursor: response.nextCursor,
            };
            break;

          case "tools/call":
            response = await MultiServerApi.callTool(
              serverId,
              params.name,
              params.arguments || {},
            );
            finalResult = response.result || response;
            break;

          case "prompts/list":
            response = await MultiServerApi.listPrompts(
              serverId,
              params?.cursor,
            );
            // The API returns { prompts: [...] }, but we need to match the schema
            finalResult = {
              prompts: response.prompts || [],
              nextCursor: response.nextCursor,
            };
            break;

          case "prompts/get":
            response = await MultiServerApi.getPrompt(
              serverId,
              params.name,
              params.arguments || {},
            );
            finalResult = response.result || response;
            break;

          case "ping":
            response = await MultiServerApi.sendPing(serverId);
            finalResult = response.result || {};
            break;

          default:
            throw new Error(`Unsupported method: ${method}`);
        }

        // Log the successful request and response to history
        multiServerHistoryStore.addRequest(
          serverId,
          serverName,
          requestString,
          JSON.stringify(finalResult),
        );

        return finalResult;
      } catch (error) {
        console.error(`Multi-server MCP request failed:`, error);

        // Log the failed request to history
        multiServerHistoryStore.addRequest(
          serverId,
          serverName,
          JSON.stringify(request),
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );

        throw error;
      }
    },
    [serverId],
  );

  return { makeRequest };
}
