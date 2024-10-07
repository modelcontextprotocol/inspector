import McpClient from "./client.js";
import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Create and connect the MCP client
const mcpClient = new McpClient("MyApp", "1.0.0");
await mcpClient.connectStdio(
  "/Users/ashwin/.nvm/versions/node/v18.20.4/bin/node",
  ["/Users/ashwin/code/example-servers/build/everything/index.js"],
);

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", async (message: string) => {
    try {
      const command = JSON.parse(message);

      if (command.type === "listResources") {
        const resources = await mcpClient.listResources();
        ws.send(JSON.stringify({ type: "resources", data: resources }));
      } else if (command.type === "readResource" && command.uri) {
        const resource = await mcpClient.readResource(command.uri);
        ws.send(JSON.stringify({ type: "resource", data: resource }));
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
  await mcpClient.close();
  process.exit();
});
