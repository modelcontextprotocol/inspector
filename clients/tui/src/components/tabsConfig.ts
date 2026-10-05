export type TabType =
  | "info"
  | "auth"
  | "resources"
  | "subscriptions"
  | "prompts"
  | "skills"
  | "tools"
  | "tasks"
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
  // `u`, not `s`: `s` is the only free letter in `Ta**s**ks`, so Subscriptions
  // takes the earliest remaining letter in its own word instead (#2432).
  { id: "subscriptions", label: "Subscriptions", accelerator: "u" },
  { id: "prompts", label: "Prompts", accelerator: "m" },
  // `k`, not `s`: `s` is not in conflict today, but the accelerator has to
  // appear in the label and be unique, and `S`kills against a future `S`ampling
  // or `S`ettings is the collision this rule anticipates. `k` is the earliest
  // remaining letter in the word after `s` and `i` (Info).
  { id: "skills", label: "Skills", accelerator: "k" },
  { id: "tools", label: "Tools", accelerator: "t" },
  // `s` is the only letter of `Tasks` not already taken (t/a/k). AuthTab binds
  // `s` locally to "clear OAuth state", so App suppresses this accelerator
  // while the Auth pane holds focus — the same carve-out the step-up `a` gets.
  { id: "tasks", label: "Tasks", accelerator: "s" },
  { id: "messages", label: "Protocol", accelerator: "p" },
  { id: "requests", label: "Network", accelerator: "n" },
  { id: "logging", label: "Console", accelerator: "o" },
];

/** Which optional tabs the connected server supports. */
export interface TabVisibility {
  showAuth: boolean;
  showLogging: boolean;
  showRequests: boolean;
  showSkills: boolean;
  /**
   * Shown only when the connected server advertised `resources.subscribe` —
   * there is nothing to subscribe to otherwise (#2432).
   */
  showSubscriptions?: boolean;
  /**
   * Shown only when the connected server supports Tasks: the legacy
   * `capabilities.tasks` or the negotiated SEP-2663 extension (#2432).
   */
  showTasks?: boolean;
}

/**
 * The tabs actually rendered for a given server.
 *
 * One source for the answer, shared by `Tabs` (which draws them) and `App`
 * (which must size the pane below them). Duplicating the filter is how the two
 * come to disagree about how tall the bar is.
 */
export function visibleTabs(v: TabVisibility): typeof tabs {
  return tabs.filter((tab) => {
    if (tab.id === "auth") return v.showAuth;
    if (tab.id === "logging") return v.showLogging;
    if (tab.id === "requests") return v.showRequests;
    if (tab.id === "skills") return v.showSkills;
    if (tab.id === "subscriptions") return v.showSubscriptions ?? false;
    if (tab.id === "tasks") return v.showTasks ?? false;
    return true;
  });
}

/** Rendered width of one tab: the 2-column marker, the label, and any count. */
function tabWidth(
  tab: { id: TabType; label: string },
  counts: Partial<Record<TabType, number>>,
): number {
  const count = counts[tab.id];
  return (
    2 + tab.label.length + (count === undefined ? 0 : ` (${count})`.length)
  );
}

/**
 * How many terminal rows the tab bar occupies at a given width.
 *
 * ⚠️ **Not always 1.** Adding Skills pushed a stdio server's bar past 100
 * columns, so it wraps at any ordinary terminal width — and `App` hard-coded
 * `tabsHeight = 1`, sizing every content pane one row too tall and clipping the
 * bottom of the TUI (Copilot). Deriving the height from the same list `Tabs`
 * renders is what keeps the two in agreement as tabs are added.
 *
 * The bar is a `flexWrap="wrap"` row with one column of padding each side and
 * no gaps, so greedy packing by rendered width matches what Ink lays out.
 */
export function tabBarRows(
  visible: readonly { id: TabType; label: string }[],
  counts: Partial<Record<TabType, number>>,
  width: number,
): number {
  const inner = Math.max(1, width - 2);
  let rows = 1;
  let used = 0;
  for (const tab of visible) {
    const w = tabWidth(tab, counts);
    // A tab wider than the whole row still occupies one of its own rather than
    // looping forever.
    if (used > 0 && used + w > inner) {
      rows += 1;
      used = w;
    } else {
      used += w;
    }
  }
  return rows;
}
