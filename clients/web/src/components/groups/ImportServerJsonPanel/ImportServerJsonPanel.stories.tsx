import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ImportServerJsonPanel } from "./ImportServerJsonPanel";

const meta: Meta<typeof ImportServerJsonPanel> = {
  title: "Groups/ImportServerJsonPanel",
  component: ImportServerJsonPanel,
  args: {
    onJsonChange: fn(),
    onValidate: fn(),
    onSelectPackage: fn(),
    onEnvVarChange: fn(),
    onServerNameChange: fn(),
    onAddServer: fn(),
    onCancel: fn(),
    selectedPackageIndex: 0,
    envVars: [],
    serverName: "",
    validationResults: [],
  },
};

export default meta;
type Story = StoryObj<typeof ImportServerJsonPanel>;

export const Empty: Story = {
  args: {
    jsonContent: "",
  },
};

export const ValidJson: Story = {
  args: {
    jsonContent: JSON.stringify(
      {
        name: "my-mcp-server",
        version: "1.0.0",
        packages: [
          {
            registryType: "npm",
            identifier: "my-mcp-server",
            runtimeHint: "node",
          },
        ],
      },
      null,
      2,
    ),
    validationResults: [
      { type: "success", message: "Valid server.json format detected" },
      { type: "success", message: "Package configuration is valid" },
      { type: "info", message: "1 package found" },
    ],
  },
};

export const MultiplePackages: Story = {
  args: {
    jsonContent: JSON.stringify(
      {
        name: "multi-server",
        packages: [
          {
            registryType: "npm",
            identifier: "@scope/server",
            runtimeHint: "node",
          },
          {
            registryType: "pip",
            identifier: "server-python",
            runtimeHint: "python3",
          },
        ],
      },
      null,
      2,
    ),
    validationResults: [
      { type: "success", message: "Valid server.json format detected" },
      { type: "info", message: "2 packages found - select one to install" },
    ],
    packages: [
      { registryType: "npm", identifier: "@scope/server", runtimeHint: "node" },
      {
        registryType: "pip",
        identifier: "server-python",
        runtimeHint: "python3",
      },
    ],
  },
};

export const WithEnvVars: Story = {
  args: {
    jsonContent: JSON.stringify(
      {
        name: "api-server",
        packages: [
          {
            registryType: "npm",
            identifier: "api-server",
            runtimeHint: "node",
          },
        ],
        envVars: [
          { name: "API_KEY", required: true },
          { name: "API_URL", required: false },
        ],
      },
      null,
      2,
    ),
    validationResults: [
      { type: "success", message: "Valid server.json format detected" },
      {
        type: "warning",
        message: "2 environment variables need to be configured",
      },
    ],
    envVars: [
      {
        name: "API_KEY",
        description: "Your API authentication key",
        required: true,
        value: "",
      },
      {
        name: "API_URL",
        description: "Base URL for the API endpoint",
        required: false,
        value: "https://api.example.com",
      },
    ],
  },
};

export const FullyConfigured: Story = {
  args: {
    jsonContent: JSON.stringify(
      {
        name: "full-server",
        version: "2.1.0",
        packages: [
          {
            registryType: "npm",
            identifier: "@org/full-server",
            runtimeHint: "node",
          },
          {
            registryType: "docker",
            identifier: "org/full-server:latest",
            runtimeHint: "docker",
          },
        ],
        envVars: [
          { name: "TOKEN", required: true },
          { name: "DEBUG", required: false },
        ],
      },
      null,
      2,
    ),
    validationResults: [
      { type: "success", message: "Valid server.json format detected" },
      { type: "success", message: "All required fields present" },
      { type: "info", message: "2 packages found" },
      {
        type: "warning",
        message: "Environment variables require configuration",
      },
    ],
    packages: [
      {
        registryType: "npm",
        identifier: "@org/full-server",
        runtimeHint: "node",
      },
      {
        registryType: "docker",
        identifier: "org/full-server:latest",
        runtimeHint: "docker",
      },
    ],
    selectedPackageIndex: 1,
    envVars: [
      {
        name: "TOKEN",
        description: "Authentication token",
        required: true,
        value: "sk-abc123",
      },
      {
        name: "DEBUG",
        description: "Enable debug logging",
        required: false,
        value: "true",
      },
    ],
    serverName: "My Custom Server",
  },
};
