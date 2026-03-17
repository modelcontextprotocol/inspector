import { Grid, Paper, Stack, Text, TextInput } from '@mantine/core'
import { ListChangedIndicator } from '../../atoms/ListChangedIndicator/ListChangedIndicator'
import { ToolListItem } from '../../molecules/ToolListItem/ToolListItem'
import { ToolDetailPanel } from '../../molecules/ToolDetailPanel/ToolDetailPanel'
import { ResultPanel } from '../../molecules/ResultPanel/ResultPanel'
import type { ToolListItemProps } from '../../molecules/ToolListItem/ToolListItem'
import type { ToolDetailPanelProps } from '../../molecules/ToolDetailPanel/ToolDetailPanel'
import type { ResultPanelProps } from '../../molecules/ResultPanel/ResultPanel'

export interface ToolsScreenProps {
  tools: ToolListItemProps[]
  selectedTool?: ToolDetailPanelProps
  result?: ResultPanelProps
  listChanged: boolean
  searchText: string
  onSearchChange: (text: string) => void
  onRefreshList: () => void
  onSelectTool: (name: string) => void
}

export function ToolsScreen({
  tools,
  selectedTool,
  result,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectTool,
}: ToolsScreenProps) {
  const filteredTools = searchText
    ? tools.filter((tool) => tool.name.toLowerCase().includes(searchText.toLowerCase()))
    : tools

  return (
    <Grid>
      <Grid.Col span={3}>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
            <TextInput
              placeholder="Search tools..."
              value={searchText}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
            {filteredTools.map((tool) => (
              <ToolListItem
                key={tool.name}
                {...tool}
                onClick={() => onSelectTool(tool.name)}
              />
            ))}
          </Stack>
        </Paper>
      </Grid.Col>

      <Grid.Col span={5}>
        <Paper withBorder p="md">
          {selectedTool ? (
            <ToolDetailPanel {...selectedTool} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Select a tool to view details
            </Text>
          )}
        </Paper>
      </Grid.Col>

      <Grid.Col span={4}>
        <Paper withBorder p="md">
          {result ? (
            <ResultPanel {...result} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Results will appear here
            </Text>
          )}
        </Paper>
      </Grid.Col>
    </Grid>
  )
}
