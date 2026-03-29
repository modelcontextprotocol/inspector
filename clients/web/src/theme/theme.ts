import { createTheme } from "@mantine/core";
import {
  ThemeActionIcon,
  ThemeAlert,
  ThemeAppShell,
  ThemeBadge,
  ThemeButton,
  ThemeCard,
  ThemeCode,
  ThemeFlex,
  ThemePaper,
  ThemeSelect,
  ThemeSwitch,
  ThemeTextInput,
  ThemeUnstyledButton,
} from "./index";

export const theme = createTheme({
  /* ── Color ──────────────────────────────────────────────── */
  primaryColor: "dark",
  primaryShade: { light: 7, dark: 4 },
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
    Paper: ThemePaper,
    Select: ThemeSelect,
    Switch: ThemeSwitch,
    TextInput: ThemeTextInput,
    UnstyledButton: ThemeUnstyledButton,
  },
});
