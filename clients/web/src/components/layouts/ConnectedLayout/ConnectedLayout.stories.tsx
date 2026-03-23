import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Text } from "@mantine/core";
import { ConnectedLayout } from "./ConnectedLayout";
import { ToolsScreen } from "../../organisms/ToolsScreen/ToolsScreen";
import { ResourcesScreen } from "../../organisms/ResourcesScreen/ResourcesScreen";
import { PromptsScreen } from "../../organisms/PromptsScreen/PromptsScreen";

const allTabs = ["Tools", "Resources", "Prompts", "Logs", "Tasks", "History"];

const meta: Meta<typeof ConnectedLayout> = {
  title: "Layouts/ConnectedLayout",
  component: ConnectedLayout,
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
type Story = StoryObj<typeof ConnectedLayout>;

export const ToolsActive: Story = {
  args: {
    activeTab: "Tools",
    children: (
      <ToolsScreen
        tools={[
          { name: "send_message", title: "Send Message", selected: false, onClick: fn() },
          { name: "create_record", title: "Create Record", selected: true, onClick: fn() },
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
              enabled: { type: "boolean", description: "Whether the record is active" },
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
                { id: 42, title: "New Record", count: 5, enabled: true, createdAt: "2026-03-17T12:00:00Z" },
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
            { name: "my-project", version: "1.0.0", settings: { debug: true, logLevel: "info" } },
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
            { name: "translate", description: "Translate text to another language" },
            { name: "code-review", description: "Review code for issues" },
          ],
          selectedPrompt: "translate",
          arguments: [
            { name: "text", required: true, description: "The text to translate" },
            { name: "targetLanguage", required: true, description: "Target language code" },
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
          messages: [
            { role: "user", content: 'Translate the following text to Spanish: "Hello, how are you?"' },
            { role: "assistant", content: "Hola, como estas?" },
          ],
        }}
        listChanged={false}
        onRefreshList={fn()}
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
