import type { Meta, StoryObj } from '@storybook/react-vite'
import { TransportBadge } from './TransportBadge'

const meta: Meta<typeof TransportBadge> = {
  title: 'Atoms/TransportBadge',
  component: TransportBadge,
}

export default meta
type Story = StoryObj<typeof TransportBadge>

export const Stdio: Story = {
  args: {
    transport: 'stdio',
  },
}

export const Http: Story = {
  args: {
    transport: 'http',
  },
}
