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
            selected: true,
            onClick: fn(),
          },
          {
            name: "README.md",
            uri: "file:///README.md",
            selected: false,
            onClick: fn(),
          },
          {
            name: "schema.sql",
            uri: "file:///schema.sql",
            annotations: { priority: 0.5 },
            selected: false,
            onClick: fn(),
          },
        ]}
        templates={[
          {
            template: "file:///users/{userId}/profile",
            variables: { userId: "" },
            onVariableChange: fn(),
            onSubmit: fn(),
          },
        ]}
        subscriptions={[
          { name: "config.json", lastUpdated: "2026-03-17T10:30:00Z" },
        ]}
        selectedResource={{
          uri: "file:///config.json",
          mimeType: "application/json",
          annotations: { audience: "developer", priority: 0.8 },
          content: JSON.stringify(
            {
              name: "my-project",
              version: "1.0.0",
              settings: { debug: true, logLevel: "info" },
            },
            null,
            2,
          ),
          lastUpdated: "2026-03-17T10:30:00Z",
          isSubscribed: true,
          onSubscribe: fn(),
          onUnsubscribe: fn(),
        }}
        listChanged={false}
        searchText=""
        onSearchChange={fn()}
        onRefreshList={fn()}
        onSelectResource={fn()}
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
        activeTasks={[
          {
            taskId: "task-001",
            status: "running",
            method: "tools/call",
            target: "batch_process",
            progress: 65,
            progressDescription: "Processing records 650 of 1000...",
            startedAt: "2026-03-17T10:05:00Z",
            onViewDetails: fn(),
            onViewResult: fn(),
            onCancel: fn(),
            onDismiss: fn(),
          },
          {
            taskId: "task-002",
            status: "waiting",
            method: "resources/read",
            target: "file:///data/large-dataset.csv",
            startedAt: "2026-03-17T10:06:12Z",
            onViewDetails: fn(),
            onViewResult: fn(),
            onCancel: fn(),
            onDismiss: fn(),
          },
        ]}
        completedTasks={[
          {
            taskId: "task-000",
            status: "completed",
            method: "tools/call",
            target: "send_message",
            startedAt: "2026-03-17T09:58:00Z",
            completedAt: "2026-03-17T09:58:02Z",
            elapsed: "2s",
            onViewDetails: fn(),
            onViewResult: fn(),
            onCancel: fn(),
            onDismiss: fn(),
          },
          {
            taskId: "task-099",
            status: "failed",
            method: "tools/call",
            target: "delete_records",
            startedAt: "2026-03-17T09:50:00Z",
            completedAt: "2026-03-17T09:50:30Z",
            elapsed: "30s",
            error: "Timeout waiting for tool response after 30s",
            onViewDetails: fn(),
            onViewResult: fn(),
            onCancel: fn(),
            onDismiss: fn(),
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
