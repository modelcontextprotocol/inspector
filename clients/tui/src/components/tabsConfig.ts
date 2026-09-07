export type TabType =
  | "info"
  | "auth"
  | "resources"
  | "prompts"
  | "skills"
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
  // `k`, not `s`: `s` is not in conflict today, but the accelerator has to
  // appear in the label and be unique, and `S`kills against a future `S`ampling
  // or `S`ettings is the collision this rule anticipates. `k` is the earliest
  // remaining letter in the word after `s` and `i` (Info).
  { id: "skills", label: "Skills", accelerator: "k" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Protocol", accelerator: "p" },
  { id: "requests", label: "Network", accelerator: "n" },
  { id: "logging", label: "Console", accelerator: "o" },
];
