import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServerInfoContent } from './ServerInfoContent';

const meta: Meta<typeof ServerInfoContent> = {
  title: 'Molecules/ServerInfoContent',
  component: ServerInfoContent,
};

export default meta;
type Story = StoryObj<typeof ServerInfoContent>;

export const FullCapabilities: Story = {
  args: {
    name: 'Everything Server',
    version: '2.1.0',
    protocolVersion: '2025-03-26',
    transport: 'stdio',
    serverCapabilities: [
      { name: 'Tools', supported: true, count: 12 },
      { name: 'Resources', supported: true, count: 8 },
      { name: 'Prompts', supported: true, count: 5 },
      { name: 'Logging', supported: true },
      { name: 'Completions', supported: true },
      { name: 'Sampling', supported: true },
      { name: 'Elicitation', supported: true },
    ],
    clientCapabilities: [
      { name: 'Roots', supported: true, count: 3 },
      { name: 'Sampling', supported: true },
      { name: 'Elicitation', supported: true },
      { name: 'Notifications', supported: true },
      { name: 'Experimental', supported: true },
    ],
  },
};

export const MinimalCapabilities: Story = {
  args: {
    name: 'Simple Server',
    version: '1.0.0',
    protocolVersion: '2025-03-26',
    transport: 'http',
    serverCapabilities: [
      { name: 'Tools', supported: true, count: 2 },
      { name: 'Resources', supported: false },
      { name: 'Prompts', supported: false },
    ],
    clientCapabilities: [
      { name: 'Roots', supported: true },
      { name: 'Sampling', supported: false },
      { name: 'Elicitation', supported: false },
    ],
  },
};

export const WithInstructions: Story = {
  args: {
    name: 'Guided Server',
    version: '1.5.0',
    protocolVersion: '2025-03-26',
    transport: 'stdio',
    serverCapabilities: [
      { name: 'Tools', supported: true, count: 4 },
      { name: 'Resources', supported: true, count: 2 },
      { name: 'Prompts', supported: true, count: 1 },
    ],
    clientCapabilities: [
      { name: 'Roots', supported: true },
      { name: 'Sampling', supported: true },
    ],
    instructions:
      'This server provides access to the project management system. Use the list_projects tool first to discover available projects before querying tasks. Rate limiting applies: max 60 requests per minute.',
  },
};

export const WithOAuth: Story = {
  args: {
    name: 'Authenticated Server',
    version: '3.0.0',
    protocolVersion: '2025-03-26',
    transport: 'http',
    serverCapabilities: [
      { name: 'Tools', supported: true, count: 6 },
      { name: 'Resources', supported: true, count: 3 },
    ],
    clientCapabilities: [
      { name: 'Roots', supported: true },
      { name: 'Sampling', supported: false },
    ],
    oauthDetails: {
      authUrl: 'https://auth.example.com/oauth2/authorize',
      scopes: ['read', 'write', 'admin'],
      accessToken: 'eyJhbGciOiJSUzI1NiIs...truncated',
    },
  },
};
