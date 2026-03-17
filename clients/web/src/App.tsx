import {
  Title,
  Text,
  Container,
  Stack,
  useMantineColorScheme,
  useComputedColorScheme,
  ActionIcon,
  Group,
} from "@mantine/core";

function App() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  return (
    <Container size="sm" py="xl">
      <Stack align="center" gap="md">
        <Group>
          <Title order={1}>MCP Inspector</Title>
          <ActionIcon
            onClick={toggleColorScheme}
            variant="default"
            size="lg"
            aria-label="Toggle color scheme"
          >
            {computedColorScheme === "dark" ? "\u2600" : "\u263E"}
          </ActionIcon>
        </Group>
        <Text c="var(--inspector-text-secondary)">
          Web client for the Model Context Protocol Inspector
        </Text>
      </Stack>
    </Container>
  );
}

export default App;
