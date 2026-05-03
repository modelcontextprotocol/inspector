import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { SUN_ICON_SVG } from "../../../test/fixtures/storyIcons";
import { AppDetailPanel } from "./AppDetailPanel";

const meta: Meta<typeof AppDetailPanel> = {
  title: "Groups/AppDetailPanel",
  component: AppDetailPanel,
  args: {
    formValues: {},
    isOpening: false,
    onFormChange: fn(),
    onOpenApp: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof AppDetailPanel>;

const noFieldsTool: Tool = {
  name: "no_input_app",
  title: "No Input App",
  description: "An app that takes no parameters.",
  inputSchema: { type: "object" },
};

const simpleTool: Tool = {
  name: "greeting_app",
  title: "Greeting App",
  description: "Renders a personalized greeting.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name to greet" },
    },
    required: ["name"],
  },
};

const multiParamTool: Tool = {
  name: "report_builder",
  title: "Report Builder",
  description: "Builds a report from a query and date range.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "SQL query" },
      from: { type: "string", description: "Start date (YYYY-MM-DD)" },
      to: { type: "string", description: "End date (YYYY-MM-DD)" },
      includeChart: { type: "boolean", description: "Render an inline chart" },
    },
    required: ["query"],
  },
};

const iconTool: Tool = {
  name: "weather_widget",
  title: "Weather Widget",
  description: "Displays the current weather for a given city.",
  icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
};

const complexSchemaTool: Tool = {
  name: "advanced_search",
  title: "Advanced Search",
  description: "Run a structured search across multiple sources.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query" },
      sources: {
        type: "array",
        items: {
          anyOf: [
            { const: "web", title: "Web" },
            { const: "docs", title: "Docs" },
            { const: "code", title: "Code" },
          ],
        },
        description: "Sources to include",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results",
      },
      filters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language filter" },
          recency: {
            type: "string",
            enum: ["day", "week", "month", "year"],
            description: "Recency",
          },
        },
      },
    },
    required: ["query"],
  },
};

export const NoFields: Story = {
  args: { tool: noFieldsTool },
};

export const SimpleStringParam: Story = {
  args: {
    tool: simpleTool,
    formValues: { name: "Ada" },
  },
};

export const MultipleParams: Story = {
  args: {
    tool: multiParamTool,
    formValues: { query: "SELECT 1" },
  },
};

export const WithIcon: Story = {
  args: {
    tool: iconTool,
    formValues: { city: "Reykjavik" },
  },
};

export const Opening: Story = {
  args: {
    tool: simpleTool,
    formValues: { name: "Ada" },
    isOpening: true,
  },
};

export const ComplexSchema: Story = {
  args: {
    tool: complexSchemaTool,
    formValues: { query: "" },
  },
};
