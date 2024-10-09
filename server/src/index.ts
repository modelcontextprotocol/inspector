import McpClient from "./client.js";
import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let mcpClient: McpClient | null = null;

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", async (message: string) => {
    try {
      const command = JSON.parse(message);

      if (command.type === "connect" && command.command && command.args) {
        mcpClient = new McpClient("MyApp", "1.0.0");
        await mcpClient.connectStdio(command.command, command.args);
        ws.send(JSON.stringify({ type: "connected" }));
      } else if (!mcpClient) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Not connected to MCP server",
          }),
        );
      } else if (command.type === "listResources") {
        const resources = await mcpClient.listResources();
        ws.send(JSON.stringify({ type: "resources", data: resources }));
      } else if (command.type === "readResource" && command.uri) {
        const resource = await mcpClient.readResource(command.uri);
        ws.send(JSON.stringify({ type: "resource", data: resource }));
      } else if (command.type === "listPrompts") {
        const prompts = await mcpClient.listPrompts();
        ws.send(JSON.stringify({ type: "prompts", data: prompts }));
      } else if (command.type === "getPrompt" && command.name) {
        const prompt = await mcpClient.getPrompt(command.name, command.args);
        ws.send(JSON.stringify({ type: "prompt", data: prompt }));
      } else if (command.type === "listTools") {
        const tools = await mcpClient.listTools();
        ws.send(JSON.stringify({ type: "tools", data: tools }));
      } else if (
        command.type === "callTool" &&
        command.name &&
        command.params
      ) {
        const result = await mcpClient.callTool(command.name, command.params);
        ws.send(
          JSON.stringify({ type: "toolResult", data: result.toolResult }),
        );
      }
    } catch (error) {
      console.error("Error:", error);
      ws.send(JSON.stringify({ type: "error", message: String(error) }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Close the client when the server is shutting down
process.on("SIGINT", async () => {
  if (mcpClient) {
    await mcpClient.close();
  }
  process.exit();
});
