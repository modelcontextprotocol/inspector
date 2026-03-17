import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ElicitationFormPanel } from './ElicitationFormPanel'

const meta: Meta<typeof ElicitationFormPanel> = {
  title: 'Molecules/ElicitationFormPanel',
  component: ElicitationFormPanel,
  args: {
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
    serverName: 'postgres-server',
    message: 'Please provide database connection details.',
    values: {},
  },
}

export default meta
type Story = StoryObj<typeof ElicitationFormPanel>

export const SimpleForm: Story = {
  args: {
    schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host' },
        port: { type: 'integer', title: 'Port' },
        database: { type: 'string', title: 'Database' },
      },
      required: ['host', 'port'],
    },
  },
}

export const WithEnums: Story = {
  args: {
    schema: {
      type: 'object',
      properties: {
        sslMode: {
          type: 'string',
          title: 'SSL Mode',
          oneOf: [
            { const: 'disable', title: 'Disable' },
            { const: 'require', title: 'Require' },
            { const: 'verify-full', title: 'Verify Full' },
          ],
        },
      },
    },
  },
}

export const AllRequired: Story = {
  args: {
    schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host' },
        port: { type: 'integer', title: 'Port' },
        database: { type: 'string', title: 'Database' },
      },
      required: ['host', 'port', 'database'],
    },
  },
}
