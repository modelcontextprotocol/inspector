import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ResourceListItem } from './ResourceListItem'

const meta: Meta<typeof ResourceListItem> = {
  title: 'Molecules/ResourceListItem',
  component: ResourceListItem,
  args: {
    onClick: fn(),
  },
}

export default meta
type Story = StoryObj<typeof ResourceListItem>

export const Default: Story = {
  args: {
    name: 'config.json',
    uri: 'file:///config.json',
    selected: false,
  },
}

export const Selected: Story = {
  args: {
    name: 'config.json',
    uri: 'file:///config.json',
    selected: true,
  },
}

export const WithAnnotations: Story = {
  args: {
    name: 'app-settings.json',
    uri: 'file:///app-settings.json',
    selected: false,
    annotations: {
      audience: 'application',
      priority: 0.9,
    },
  },
}

export const WithHighPriority: Story = {
  args: {
    name: 'critical-data.json',
    uri: 'file:///critical-data.json',
    selected: false,
    annotations: {
      audience: 'user',
      priority: 0.8,
    },
  },
}

export const NoPriority: Story = {
  args: {
    name: 'readme.md',
    uri: 'file:///readme.md',
    selected: false,
    annotations: {
      audience: 'user',
    },
  },
}
