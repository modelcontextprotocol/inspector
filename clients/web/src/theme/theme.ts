import { createTheme } from "@mantine/core";
import {
  ThemeActionIcon,
  ThemeAlert,
  ThemeAppShell,
  ThemeBadge,
  ThemeButton,
  ThemeCard,
  ThemeCode,
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
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
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
    Paper: ThemePaper,
    Select: ThemeSelect,
    Switch: ThemeSwitch,
    TextInput: ThemeTextInput,
    UnstyledButton: ThemeUnstyledButton,
  },
});
