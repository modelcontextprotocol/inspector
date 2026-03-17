import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Container, Paper, Stack, Text } from '@mantine/core';
import { HomeLayout } from './HomeLayout';

const meta: Meta<typeof HomeLayout> = {
  title: 'Layouts/HomeLayout',
  component: HomeLayout,
  parameters: { layout: 'fullscreen' },
  args: {
    onToggleTheme: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HomeLayout>;

export const Light: Story = {
  args: {
    children: <Text>Page content goes here</Text>,
  },
};

export const WithContent: Story = {
  args: {
    children: (
      <Container>
        <Stack>
          <Paper p="md" shadow="xs">
            <Text fw={500}>Local Dev Server</Text>
            <Text size="sm" c="dimmed">npx @modelcontextprotocol/server-filesystem</Text>
          </Paper>
          <Paper p="md" shadow="xs">
            <Text fw={500}>Database Tools</Text>
            <Text size="sm" c="dimmed">python -m mcp_server_sqlite</Text>
          </Paper>
          <Paper p="md" shadow="xs">
            <Text fw={500}>Remote API Server</Text>
            <Text size="sm" c="dimmed">https://api.example.com/mcp</Text>
          </Paper>
        </Stack>
      </Container>
    ),
  },
};
