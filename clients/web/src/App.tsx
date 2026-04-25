import {
  ActionIcon,
  Container,
  Group,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { MdDarkMode, MdLightMode } from "react-icons/md";

const PageContainer = Container.withProps({
  size: "sm",
  py: "xl",
});

const PageStack = Stack.withProps({
  align: "center",
  gap: "md",
});

const ThemeToggle = ActionIcon.withProps({
  variant: "default",
  size: "lg",
  "aria-label": "Toggle color scheme",
});

const SubtitleText = Text.withProps({
  c: "var(--inspector-text-secondary)",
});

function App() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const ThemeIcon = isDark ? MdLightMode : MdDarkMode;

  function toggleColorScheme() {
    setColorScheme(isDark ? "light" : "dark");
  }

  return (
    <PageContainer>
      <PageStack>
        <Group>
          <Title order={1}>MCP Inspector</Title>
          <ThemeToggle onClick={toggleColorScheme}>
            <ThemeIcon size={20} />
          </ThemeToggle>
        </Group>
        <SubtitleText>
          Web client for the Model Context Protocol Inspector
        </SubtitleText>
      </PageStack>
    </PageContainer>
  );
}

export default App;
