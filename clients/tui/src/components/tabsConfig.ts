export type TabType =
  | "info"
  | "auth"
  | "resources"
  | "prompts"
  | "tools"
  | "messages"
  | "requests"
  | "logging";

/**
 * Tab bar labels + single-letter accelerators.
 *
 * Accelerators must be unique and appear in the label. Prefer the first letter;
 * when that conflicts (Protocol vs Prompts both want `p`, Console vs Connect's
 * global `c`), pick the earliest remaining letter in the word.
 *
 * Connect (`c`) / Disconnect (`d`) are global actions, not tab accelerators —
 * Console therefore uses `o` (C**o**nsole).
 */
export const tabs: { id: TabType; label: string; accelerator: string }[] = [
  { id: "info", label: "Info", accelerator: "i" },
  { id: "auth", label: "Auth", accelerator: "a" },
  { id: "resources", label: "Resources", accelerator: "r" },
  { id: "prompts", label: "Prompts", accelerator: "m" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Protocol", accelerator: "p" },
  { id: "requests", label: "Network", accelerator: "n" },
  { id: "logging", label: "Console", accelerator: "o" },
];
