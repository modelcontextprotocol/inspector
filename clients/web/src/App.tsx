import { Title, Text, Container, Stack } from '@mantine/core'

function App() {
  return (
    <Container size="sm" py="xl">
      <Stack align="center" gap="md">
        <Title order={1}>MCP Inspector</Title>
        <Text c="dimmed">Web client for the Model Context Protocol Inspector</Text>
      </Stack>
    </Container>
  )
}

export default App
