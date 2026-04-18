import { createTheme, type MantineColorsTuple } from "@mantine/core";
import {
  ThemeActionIcon,
  ThemeAlert,
  ThemeAppShell,
  ThemeBadge,
  ThemeButton,
  ThemeCard,
  ThemeCode,
  ThemeFlex,
  ThemeInput,
  ThemePaper,
  ThemeSelect,
  ThemeSwitch,
  ThemeTextInput,
  ThemeUnstyledButton,
} from "./index";

const inspector: MantineColorsTuple = [
  "#f0f3fa",
  "#dee3ee",
  "#b9c5de",
  "#91a5cf",
  "#7089c3",
  "#5b78bb",
  "#4f70b9",
  "#405fa3",
  "#375493",
  "#121e36",
];

export const theme = createTheme({
  colors: {
    inspector,
  },
  /* ── Color ──────────────────────────────────────────────── */
  primaryColor: "inspector",
  primaryShade: { light: 7, dark: 8 },
  autoContrast: true,

  /* ── Shape ──────────────────────────────────────────────── */
  defaultRadius: "md",
  cursorType: "pointer",

  /* ── Typography ─────────────────────────────────────────── */
  fontFamily: '"Fredoka", sans-serif',
  fontFamilyMonospace: '"Roboto Mono", monospace',
  headings: {
    fontFamily: '"Fredoka", sans-serif',
    fontWeight: "600",
  },

  /* ── Component overrides ────────────────────────────────── */
  components: {
    ActionIcon: ThemeActionIcon,
    Alert: ThemeAlert,
    AppShell: ThemeAppShell,
    Badge: ThemeBadge,
    Button: ThemeButton,
    Card: ThemeCard,
    Code: ThemeCode,
    Flex: ThemeFlex,
    Input: ThemeInput,
    Paper: ThemePaper,
    Select: ThemeSelect,
    Switch: ThemeSwitch,
    TextInput: ThemeTextInput,
    UnstyledButton: ThemeUnstyledButton,
  },
});
