import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ToolsScreen } from './ToolsScreen'
import type { ToolListItemProps } from '../../molecules/ToolListItem/ToolListItem'
import type { ToolDetailPanelProps } from '../../molecules/ToolDetailPanel/ToolDetailPanel'
import type { ResultPanelProps } from '../../molecules/ResultPanel/ResultPanel'

const meta: Meta<typeof ToolsScreen> = {
  component: ToolsScreen,
  parameters: { layout: 'fullscreen' },
  args: {
    searchText: '',
    listChanged: false,
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectTool: fn(),
  },
}

export default meta
type Story = StoryObj<typeof ToolsScreen>

const sampleTools: ToolListItemProps[] = [
  { name: 'send_message', selected: false, onClick: fn() },
  {
    name: 'create_record',
    annotations: [{ label: 'read-only' }],
    selected: false,
    onClick: fn(),
  },
  {
    name: 'delete_records',
    annotations: [{ label: 'destructive', variant: 'destructive' }],
    selected: false,
    onClick: fn(),
  },
  { name: 'list_users', selected: false, onClick: fn() },
  {
    name: 'batch_process',
    annotations: [{ label: 'long-run', variant: 'longRun' }],
    selected: false,
    onClick: fn(),
  },
]

const selectedToolData: ToolDetailPanelProps = {
  name: 'create_record',
  description: 'Creates a new record with the given parameters',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Record title' },
      count: { type: 'number', description: 'Number of items' },
      enabled: { type: 'boolean', description: 'Whether the record is active' },
    },
    required: ['title'],
  },
  formValues: {},
  isExecuting: false,
  onFormChange: fn(),
  onExecute: fn(),
  onCancel: fn(),
}

const resultData: ResultPanelProps = {
  content: [
    {
      type: 'text',
      text: JSON.stringify(
        { id: 42, title: 'New Record', count: 5, enabled: true, createdAt: '2026-03-17T12:00:00Z' },
        null,
        2
      ),
    },
  ],
  onCopy: fn(),
  onClear: fn(),
}

function toolsWithSelected(selectedName: string): ToolListItemProps[] {
  return sampleTools.map((tool) => ({
    ...tool,
    selected: tool.name === selectedName,
  }))
}

export const NoSelection: Story = {
  args: {
    tools: sampleTools,
  },
}

export const ToolSelected: Story = {
  args: {
    tools: toolsWithSelected('create_record'),
    selectedTool: selectedToolData,
  },
}

export const WithResult: Story = {
  args: {
    tools: toolsWithSelected('create_record'),
    selectedTool: selectedToolData,
    result: resultData,
  },
}

export const WithListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
}
