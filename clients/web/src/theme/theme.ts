import { createTheme, type MantineColorsTuple } from "@mantine/core";
import {
  ThemeAccordion,
  ThemeActionIcon,
  ThemeAlert,
  ThemeAppShell,
  ThemeAutocomplete,
  ThemeBadge,
  ThemeButton,
  ThemeCard,
  ThemeCode,
  ThemeFlex,
  ThemeGroup,
  ThemeInput,
  ThemeModal,
  ThemeModalRoot,
  ThemePaper,
  ThemeScrollArea,
  ThemeScrollAreaAutosize,
  ThemeSelect,
  ThemeSwitch,
  ThemeText,
  ThemeTextInput,
  ThemeTitle,
  ThemeUnstyledButton,
} from "./index";

// Accessible light/dark palette. Each tuple runs shade 0 (lightest) → 9
// (darkest) per the Mantine convention. These tuples are the single source of
// literal hex — every `--inspector-*` token in App.css references
// `--mantine-color-*`, so improving the tuples cascades through the whole UI.
const inspector: MantineColorsTuple = [
  "#eef3ff",
  "#dce6ff",
  "#b7ccff",
  "#8facfc",
  "#6b8ef8",
  "#4f78f3",
  "#3d68ee",
  "#2f59e0",
  "#2749b8",
  "#16265e",
];

// Cool-slate neutrals (light-mode surfaces, borders, text).
const gray: MantineColorsTuple = [
  "#f7f8fa",
  "#eef0f4",
  "#e2e5ec",
  "#cfd4de",
  "#b0b7c5",
  "#8d95a6",
  "#6c7486",
  "#515868",
  "#3a3f4b",
  "#23272f",
];

// Charcoal (dark-mode surfaces 9→6, text 0→2).
const dark: MantineColorsTuple = [
  "#c9cdd6",
  "#aeb4c0",
  "#8b93a3",
  "#6a7284",
  "#464c5b",
  "#363b47",
  "#2b2f3a",
  "#23262f",
  "#1a1d24",
  "#131519",
];

const green: MantineColorsTuple = [
  "#e6f7ee",
  "#c6efd7",
  "#96e2b8",
  "#5fd196",
  "#33bd79",
  "#1aa864",
  "#109655",
  "#0d7d47",
  "#0a6339",
  "#074a2b",
];

const red: MantineColorsTuple = [
  "#ffecec",
  "#ffd7d7",
  "#ffb3b3",
  "#ff8585",
  "#f95f60",
  "#ef4344",
  "#e03236",
  "#c62328",
  "#a11a1f",
  "#7d1418",
];

// Amber (Mantine's `yellow` slot — warning / connecting / cancelled).
const yellow: MantineColorsTuple = [
  "#fff7e6",
  "#ffecc2",
  "#ffdb8a",
  "#fbc94f",
  "#f5b722",
  "#e8a800",
  "#d19700",
  "#a87800",
  "#855f00",
  "#634700",
];

// Azure (Mantine's `blue` slot — info logs / running tasks).
const blue: MantineColorsTuple = [
  "#e7f1ff",
  "#cfe2ff",
  "#a3c8ff",
  "#6fa6fb",
  "#4589f5",
  "#2a75ee",
  "#1b66e0",
  "#1553bb",
  "#124399",
  "#0d2f6b",
];

const teal: MantineColorsTuple = [
  "#e2f7f4",
  "#bfeee8",
  "#8adfd4",
  "#4ecabb",
  "#23b2a2",
  "#109e8f",
  "#0d8a7d",
  "#0a6f65",
  "#08574f",
  "#06403a",
];

// Violet accent (docs / social glyphs, direction-badge incoming).
const violet: MantineColorsTuple = [
  "#faf0ff",
  "#f0dcff",
  "#e0bbff",
  "#cb91fb",
  "#b264f5",
  "#a03bf5",
  "#9127e6",
  "#7a1fc4",
  "#63189e",
  "#3f0f66",
];

export const theme = createTheme({
  colors: {
    inspector,
    gray,
    dark,
    green,
    red,
    yellow,
    blue,
    teal,
    violet,
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
    Accordion: ThemeAccordion,
    ActionIcon: ThemeActionIcon,
    Alert: ThemeAlert,
    AppShell: ThemeAppShell,
    Autocomplete: ThemeAutocomplete,
    Badge: ThemeBadge,
    Button: ThemeButton,
    Card: ThemeCard,
    Code: ThemeCode,
    Flex: ThemeFlex,
    Group: ThemeGroup,
    Input: ThemeInput,
    Modal: ThemeModal,
    ModalRoot: ThemeModalRoot,
    Paper: ThemePaper,
    ScrollArea: ThemeScrollArea,
    ScrollAreaAutosize: ThemeScrollAreaAutosize,
    Select: ThemeSelect,
    Switch: ThemeSwitch,
    Text: ThemeText,
    TextInput: ThemeTextInput,
    Title: ThemeTitle,
    UnstyledButton: ThemeUnstyledButton,
  },
});
