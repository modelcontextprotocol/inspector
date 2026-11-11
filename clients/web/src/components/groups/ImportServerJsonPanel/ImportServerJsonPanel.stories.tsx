import type { InspectorServerJsonDraft } from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ImportServerJsonPanel } from "./ImportServerJsonPanel";

const emptyDraft: InspectorServerJsonDraft = {
  rawText: "",
  envOverrides: {},
};

const meta: Meta<typeof ImportServerJsonPanel> = {
  title: "Groups/ImportServerJsonPanel",
  component: ImportServerJsonPanel,
  args: {
    onJsonChange: fn(),
    onSelectPackage: fn(),
    onEnvVarChange: fn(),
    onServerNameChange: fn(),
    onAddServer: fn(),
    envVars: [],
    validation: [],
  },
};

export default meta;
type Story = StoryObj<typeof ImportServerJsonPanel>;

export const Empty: Story = {
  args: {
    draft: emptyDraft,
  },
};

export const ValidJson: Story = {
  args: {
    draft: {
      rawText: JSON.stringify(
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
      envOverrides: {},
    },
    validation: [
      { type: "success", message: "Valid server.json format detected" },
      { type: "success", message: "Package configuration is valid" },
      { type: "info", message: "1 package found" },
    ],
    launchPreview: {
      kind: "command",
      value: "npx -y my-mcp-server",
      env: [],
    },
  },
};

export const MultiplePackages: Story = {
  args: {
    draft: {
      rawText: JSON.stringify(
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
      envOverrides: {},
    },
    validation: [
      { type: "success", message: "Valid server.json format detected" },
      { type: "info", message: "2 packages found - select one to install" },
    ],
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
};

export const WithEnvVars: Story = {
  args: {
    draft: {
      rawText: JSON.stringify(
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
      envOverrides: {},
    },
    validation: [
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
    draft: {
      rawText: JSON.stringify(
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
      selectedPackageIndex: 1,
      envOverrides: { TOKEN: "sk-abc123", DEBUG: "true" },
      nameOverride: "My Custom Server",
    },
    validation: [
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
    launchPreview: {
      kind: "command",
      value: "npx -y @org/full-server",
      env: [
        {
          name: "TOKEN",
          display: "TOKEN=********",
          masked: true,
          runtimeControl: false,
        },
        {
          name: "DEBUG",
          display: "DEBUG=true",
          masked: false,
          runtimeControl: false,
        },
      ],
    },
  },
};

const runtimeControlServerJson = JSON.stringify(
  {
    name: "io.github.acme/server-everything",
    version: "1.0.0",
    packages: [
      {
        registryType: "npm",
        identifier: "@acme/server-everything",
        version: "1.0.0",
        transport: { type: "stdio" },
        environmentVariables: [
          {
            name: "npm_config_registry",
            description: "Registry mirror",
            default: "https://registry.example.invalid/",
          },
          {
            name: "NODE_OPTIONS",
            description: "Node runtime options",
            isSecret: true,
            default: "--require ./preload.js",
          },
          // No document-supplied value: the user types it, so it is masked.
          { name: "API_KEY", isSecret: true },
        ],
      },
    ],
  },
  null,
  2,
);

const runtimeControlArgs = {
  draft: { rawText: runtimeControlServerJson, envOverrides: {} },
  validation: [
    {
      type: "success" as const,
      message: 'Valid server.json for "io.github.acme/server-everything".',
    },
    { type: "info" as const, message: "1 runnable option(s) found." },
  ],
  envVars: [
    {
      name: "npm_config_registry",
      description: "Registry mirror",
      required: false,
      value: "https://registry.example.invalid/",
    },
    {
      name: "NODE_OPTIONS",
      description: "Node runtime options",
      required: false,
      value: "--require ./preload.js",
    },
    { name: "API_KEY", required: false, value: "sk-live-123", isSecret: true },
  ],
  launchPreview: {
    kind: "command" as const,
    value: "npx -y @acme/server-everything@1.0.0",
    env: [
      {
        name: "npm_config_registry",
        display: "npm_config_registry=https://registry.example.invalid/",
        masked: false,
        runtimeControl: true,
      },
      {
        name: "NODE_OPTIONS",
        display: "NODE_OPTIONS='--require ./preload.js'",
        masked: false,
        runtimeControl: true,
      },
      {
        name: "API_KEY",
        display: "API_KEY=********",
        masked: true,
        runtimeControl: false,
      },
    ],
  },
};

/**
 * A server.json whose env defaults change what the command runs: each one is
 * shown with its value and flagged, and Add waits for the confirmation. The
 * `NODE_OPTIONS` value stays visible even though the document marks it secret.
 */
export const RuntimeControlEnv: Story = {
  args: {
    ...runtimeControlArgs,
    addDisabled: true,
    runtimeControlAcknowledged: false,
    onRuntimeControlAcknowledgedChange: fn(),
  },
};

/** The same launch once the user has confirmed the flagged values. */
export const RuntimeControlEnvAcknowledged: Story = {
  args: {
    ...runtimeControlArgs,
    addDisabled: false,
    runtimeControlAcknowledged: true,
    onRuntimeControlAcknowledgedChange: fn(),
  },
};
