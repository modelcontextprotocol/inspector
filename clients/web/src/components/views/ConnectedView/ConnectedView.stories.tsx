import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Text } from "@mantine/core";
import { ConnectedView } from "./ConnectedView.js";
import { ToolsScreen } from "../../screens/ToolsScreen/ToolsScreen";
import { ResourcesScreen } from "../../screens/ResourcesScreen/ResourcesScreen";
import { PromptsScreen } from "../../screens/PromptsScreen/PromptsScreen";
import { LoggingScreen } from "../../screens/LoggingScreen/LoggingScreen";
import { TasksScreen } from "../../screens/TasksScreen/TasksScreen";
import { HistoryScreen } from "../../screens/HistoryScreen/HistoryScreen";

import type { LogEntryProps } from "../../elements/LogEntry/LogEntry";
import type { LogLevel } from "../../elements/LogEntry/LogEntry";

const allTabs = ["Tools", "Resources", "Prompts", "Logs", "Tasks", "History"];

const logMessages: { level: LogLevel; message: string; logger?: string }[] = [
  { level: "info", message: "Server started on port 3000" },
  {
    level: "debug",
    message: "Loading configuration from /etc/mcp/config.json",
    logger: "config",
  },
  {
    level: "warning",
    message: "Deprecated API endpoint called: /v1/tools",
    logger: "http",
  },
  { level: "info", message: "Client connected: inspector-web-ui" },
  {
    level: "error",
    message: "Failed to read resource: file not found at /data/missing.txt",
    logger: "resources",
  },
  {
    level: "info",
    message: "Tool execution completed: search_files (245ms)",
    logger: "tools",
  },
  {
    level: "debug",
    message: "Parsing JSON-RPC request body",
    logger: "transport",
  },
  {
    level: "info",
    message: "Listing available tools for client session",
    logger: "tools",
  },
  {
    level: "warning",
    message: "Slow query detected: 1200ms for resource lookup",
    logger: "db",
  },
  {
    level: "info",
    message: "Resource subscription added: file:///config.json",
    logger: "resources",
  },
  {
    level: "debug",
    message: "Heartbeat ping received from client",
    logger: "session",
  },
  {
    level: "error",
    message: "Permission denied reading /etc/secrets.env",
    logger: "resources",
  },
  {
    level: "info",
    message: "Prompt 'summarize' resolved with 2 messages",
    logger: "prompts",
  },
  {
    level: "debug",
    message: "Cache hit for resource: db://users/42",
    logger: "cache",
  },
  {
    level: "info",
    message: "Tool 'create_record' executed successfully in 89ms",
    logger: "tools",
  },
  {
    level: "warning",
    message: "Client reconnection attempt #3",
    logger: "session",
  },
  {
    level: "info",
    message: "New resource detected: file:///data/output.csv",
    logger: "resources",
  },
  {
    level: "debug",
    message: "Serializing response payload (2.4KB)",
    logger: "transport",
  },
  {
    level: "error",
    message: "Timeout waiting for tool response after 30s",
    logger: "tools",
  },
  {
    level: "info",
    message: "Session initialized with capabilities: tools, resources, prompts",
  },
  {
    level: "debug",
    message: "Validating input schema for tool 'batch_process'",
    logger: "tools",
  },
  {
    level: "info",
    message: "Resource template resolved: db://tables/users/rows/15",
    logger: "resources",
  },
  {
    level: "warning",
    message: "Memory usage at 78% — consider increasing limits",
    logger: "system",
  },
  {
    level: "info",
    message: "Client disconnected gracefully",
    logger: "session",
  },
  {
    level: "debug",
    message: "Flushing log buffer to disk (128 entries)",
    logger: "logging",
  },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

const sampleLogEntries: LogEntryProps[] = Array.from({ length: 50 }, (_, i) => {
  const src = logMessages[i % logMessages.length];
  return {
    timestamp: `2026-03-17T10:00:${pad(i + 1)}Z`,
    level: src.level,
    message: src.message,
    logger: src.logger,
  };
});

const meta: Meta<typeof ConnectedView> = {
  title: "Views/ConnectedView",
  component: ConnectedView,
  parameters: { layout: "fullscreen" },
  args: {
    serverName: "my-mcp-server",
    status: "connected",
    latencyMs: 23,
    availableTabs: allTabs,
    activeTab: "Tools",
    onTabChange: fn(),
    onDisconnect: fn(),
    onToggleTheme: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ConnectedView>;

export const ToolsActive: Story = {
  args: {
    activeTab: "Tools",
    children: (
      <ToolsScreen
        tools={[
          {
            name: "send_message",
            title: "Send Message",
            selected: false,
            onClick: fn(),
          },
          {
            name: "create_record",
            title: "Create Record",
            selected: true,
            onClick: fn(),
          },
          { name: "delete_records", selected: false, onClick: fn() },
          { name: "list_users", selected: false, onClick: fn() },
          { name: "batch_process", selected: false, onClick: fn() },
        ]}
        selectedTool={{
          name: "create_record",
          title: "Create Record",
          description: "Creates a new record with the given parameters",
          schema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Record title" },
              count: { type: "number", description: "Number of items" },
              enabled: {
                type: "boolean",
                description: "Whether the record is active",
              },
            },
            required: ["title"],
          },
          formValues: {},
          isExecuting: false,
          onFormChange: fn(),
          onExecute: fn(),
          onCancel: fn(),
        }}
        result={{
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: 42,
                  title: "New Record",
                  count: 5,
                  enabled: true,
                  createdAt: "2026-03-17T12:00:00Z",
                },
                null,
                2,
              ),
            },
          ],
          onClear: fn(),
        }}
        searchText=""
        listChanged={false}
        onSearchChange={fn()}
        onRefreshList={fn()}
        onSelectTool={fn()}
      />
    ),
  },
};

export const ResourcesActive: Story = {
  args: {
    activeTab: "Resources",
    children: (
      <ResourcesScreen
        resources={[
          {
            name: "config.json",
            uri: "file:///config.json",
            annotations: { audience: "developer", priority: 0.8 },
            selected: false,
          },
          {
            name: "README.md",
            uri: "file:///README.md",
            selected: false,
          },
          {
            name: "schema.sql",
            uri: "file:///schema.sql",
            annotations: { priority: 0.5 },
            selected: false,
          },
          {
            name: "package.json",
            uri: "file:///package.json",
            annotations: { audience: "developer" },
            selected: false,
          },
          {
            name: "tsconfig.json",
            uri: "file:///tsconfig.json",
            annotations: { audience: "developer", priority: 0.3 },
            selected: false,
          },
          {
            name: ".env.example",
            uri: "file:///.env.example",
            selected: false,
          },
          {
            name: "docker-compose.yml",
            uri: "file:///docker-compose.yml",
            annotations: { priority: 0.6 },
            selected: false,
          },
          {
            name: "migrations/001_init.sql",
            uri: "file:///migrations/001_init.sql",
            annotations: { audience: "developer", priority: 0.4 },
            selected: false,
          },
          {
            name: "migrations/002_add_users.sql",
            uri: "file:///migrations/002_add_users.sql",
            annotations: { audience: "developer", priority: 0.4 },
            selected: false,
          },
          {
            name: "seeds/users.json",
            uri: "file:///seeds/users.json",
            selected: false,
          },
          {
            name: "seeds/products.json",
            uri: "file:///seeds/products.json",
            selected: false,
          },
          {
            name: "certs/server.pem",
            uri: "file:///certs/server.pem",
            annotations: { priority: 0.9 },
            selected: false,
          },
          {
            name: "logs/access.log",
            uri: "file:///logs/access.log",
            annotations: { audience: "application", priority: 0.2 },
            selected: false,
          },
          {
            name: "logs/error.log",
            uri: "file:///logs/error.log",
            annotations: { audience: "application", priority: 0.7 },
            selected: false,
          },
          {
            name: "api-spec.yaml",
            uri: "file:///api-spec.yaml",
            annotations: { audience: "developer" },
            selected: false,
          },
          {
            name: "CHANGELOG.md",
            uri: "file:///CHANGELOG.md",
            selected: false,
          },
          {
            name: "LICENSE",
            uri: "file:///LICENSE",
            selected: false,
          },
          {
            name: "Makefile",
            uri: "file:///Makefile",
            annotations: { audience: "developer", priority: 0.3 },
            selected: false,
          },
        ]}
        templates={[
          {
            name: "User Profile",
            uriTemplate: "file:///users/{userId}/profile",
            selected: true,
          },
          {
            name: "Table Row",
            title: "Database Table Row",
            uriTemplate: "db://tables/{tableName}/rows/{rowId}",
            selected: false,
          },
          {
            name: "Log File",
            title: "Application Log",
            uriTemplate: "file:///logs/{service}/{date}.log",
            selected: false,
          },
          {
            name: "Migration",
            uriTemplate: "file:///migrations/{version}_{name}.sql",
            selected: false,
          },
          {
            name: "Config by Environment",
            title: "Environment Config",
            uriTemplate: "file:///config/{environment}.json",
            selected: false,
          },
          {
            name: "API Endpoint",
            uriTemplate: "https://api.example.com/{version}/{resource}",
            selected: false,
          },
          {
            name: "Report",
            title: "Generated Report",
            uriTemplate: "reports://{reportType}/{year}/{month}",
            selected: false,
          },
        ]}
        subscriptions={[
          {
            name: "config.json",
            uri: "file:///config.json",
            lastUpdated: "2026-03-17T10:30:00Z",
          },
          {
            name: "schema.sql",
            uri: "file:///schema.sql",
            lastUpdated: "2026-03-17T10:28:00Z",
          },
          {
            name: "docker-compose.yml",
            uri: "file:///docker-compose.yml",
            lastUpdated: "2026-03-17T09:45:00Z",
          },
          {
            name: "logs/error.log",
            uri: "file:///logs/error.log",
            lastUpdated: "2026-03-17T10:31:12Z",
          },
          {
            name: "certs/server.pem",
            uri: "file:///certs/server.pem",
          },
          {
            name: "api-spec.yaml",
            uri: "file:///api-spec.yaml",
            lastUpdated: "2026-03-17T08:15:00Z",
          },
          {
            name: "package.json",
            uri: "file:///package.json",
            lastUpdated: "2026-03-17T10:22:00Z",
          },
          {
            name: "seeds/users.json",
            uri: "file:///seeds/users.json",
          },
        ]}
        selectedTemplate={{
          name: "User Profile",
          uriTemplate: "file:///users/{userId}/profile",
          description: "Fetch a user profile by their unique identifier.",
        }}
        selectedResource={{
          uri: "file:///users/42/profile",
          mimeType: "application/json",
          annotations: { audience: "developer", priority: 0.8 },
          content: JSON.stringify(
            { id: 42, name: "Alice", email: "alice@example.com" },
            null,
            2,
          ),
          lastUpdated: "2026-03-17T11:15:00Z",
          isSubscribed: false,
        }}
        listChanged={false}
        searchText=""
        onSearchChange={fn()}
        onRefreshList={fn()}
        onSelectUri={fn()}
        onSelectTemplate={fn()}
        onReadResource={fn()}
        onSubscribeResource={fn()}
        onUnsubscribeResource={fn()}
      />
    ),
  },
};

export const PromptsActive: Story = {
  args: {
    activeTab: "Prompts",
    children: (
      <PromptsScreen
        promptForm={{
          prompts: [
            { name: "summarize", description: "Summarize a document" },
            {
              name: "translate",
              description: "Translate text to another language",
            },
            { name: "code-review", description: "Review code for issues" },
          ],
          selectedPrompt: "translate",
          arguments: [
            {
              name: "text",
              required: true,
              description: "The text to translate",
            },
            {
              name: "targetLanguage",
              required: true,
              description: "Target language code",
            },
          ],
          argumentValues: {
            text: "Hello, how are you?",
            targetLanguage: "es",
          },
          onSelectPrompt: fn(),
          onArgumentChange: fn(),
          onGetPrompt: fn(),
        }}
        messages={{
          onCopyAll: fn(),
          messages: [
            {
              role: "user",
              content:
                'Translate the following text to Spanish: "Hello, how are you?"',
            },
            { role: "assistant", content: "Hola, como estas?" },
          ],
        }}
        listChanged={false}
        onRefreshList={fn()}
      />
    ),
  },
};

export const LoggingActive: Story = {
  args: {
    activeTab: "Logs",
    children: (
      <LoggingScreen
        currentLevel="info"
        onSetLevel={fn()}
        onClear={fn()}
        onExport={fn()}
        entries={sampleLogEntries}
        autoScroll={true}
        onToggleAutoScroll={fn()}
        onCopyAll={fn()}
      />
    ),
  },
};

export const TasksActive: Story = {
  args: {
    activeTab: "Tasks",
    children: (
      <TasksScreen
        tasks={[
          {
            taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
            status: "running",
            method: "tools/call",
            target: "batch_process",
            progress: 65,
            progressDescription: "Processing records 650 of 1000...",
            startedAt: "3/29/2026, 8:18:20 PM",
            lastUpdated: "3/29/2026, 8:18:22 PM",
            ttl: 300000,
            isListExpanded: true,
            onCancel: fn(),
          },
          {
            taskId: "4100b5e0b0ed9cd0023330342d1bf647",
            status: "waiting",
            method: "resources/read",
            target: "file:///data/large-dataset.csv",
            startedAt: "3/29/2026, 8:17:55 PM",
            lastUpdated: "3/29/2026, 8:17:55 PM",
            ttl: 300000,
            isListExpanded: true,
            onCancel: fn(),
          },
          {
            taskId: "d487b49aa39023d907b5a2a5b506cb3",
            status: "completed",
            method: "tools/call",
            target: "send_message",
            startedAt: "3/29/2026, 8:16:47 PM",
            completedAt: "3/29/2026, 8:16:49 PM",
            lastUpdated: "3/29/2026, 8:16:49 PM",
            ttl: 300000,
            isListExpanded: true,
            onCancel: fn(),
          },
          {
            taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
            status: "failed",
            method: "tools/call",
            target: "delete_records",
            startedAt: "3/29/2026, 8:17:27 PM",
            completedAt: "3/29/2026, 8:17:57 PM",
            lastUpdated: "3/29/2026, 8:17:57 PM",
            ttl: 300000,
            error: "Timeout waiting for tool response after 30s",
            isListExpanded: true,
            onCancel: fn(),
          },
        ]}
        onRefresh={fn()}
        onClearHistory={fn()}
      />
    ),
  },
};

export const HistoryActive: Story = {
  args: {
    activeTab: "History",
    children: (
      <HistoryScreen
        entries={[
          {
            timestamp: "2026-03-17T10:00:00Z",
            method: "tools/call",
            target: "send_message",
            status: "success",
            durationMs: 120,
            parameters: { message: "Hello, world!" },
            response: { result: "Message sent successfully" },
            isPinned: false,
            isListExpanded: false,
            onReplay: fn(),
            onTogglePin: fn(),
          },
          {
            timestamp: "2026-03-17T10:01:00Z",
            method: "resources/read",
            target: "config.json",
            status: "success",
            durationMs: 45,
            parameters: { uri: "file:///config.json" },
            response: {
              contents: [{ uri: "file:///config.json", text: "{}" }],
            },
            isPinned: false,
            isListExpanded: false,
            onReplay: fn(),
            onTogglePin: fn(),
          },
          {
            timestamp: "2026-03-17T10:02:00Z",
            method: "tools/call",
            target: "delete_records",
            status: "error",
            durationMs: 350,
            parameters: { ids: [1, 2, 3] },
            response: { error: "Permission denied" },
            isPinned: false,
            isListExpanded: true,
            onReplay: fn(),
            onTogglePin: fn(),
          },
        ]}
        pinnedEntries={[
          {
            timestamp: "2026-03-17T09:30:00Z",
            method: "tools/list",
            status: "success",
            durationMs: 80,
            response: { tools: ["send_message", "list_users"] },
            isPinned: true,
            isListExpanded: false,
            onReplay: fn(),
            onTogglePin: fn(),
          },
          {
            timestamp: "2026-03-17T09:35:00Z",
            method: "prompts/get",
            target: "greeting",
            status: "success",
            durationMs: 60,
            parameters: { name: "greeting" },
            response: {
              messages: [
                { role: "user", content: { type: "text", text: "Hello!" } },
              ],
            },
            isPinned: true,
            isListExpanded: false,
            onReplay: fn(),
            onTogglePin: fn(),
          },
        ]}
        onClearAll={fn()}
        onExport={fn()}
      />
    ),
  },
};

export const LimitedTabs: Story = {
  args: {
    availableTabs: ["Tools", "Resources", "Prompts"],
    children: <Text>Tools screen content</Text>,
  },
};

export const LongServerName: Story = {
  args: {
    serverName: "my-very-long-server-name-that-might-overflow-is",
    children: <Text>Tools screen content</Text>,
  },
};
