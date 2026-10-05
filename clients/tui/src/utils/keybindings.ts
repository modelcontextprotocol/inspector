/**
 * The TUI's keybinding reference, as data (#2436).
 *
 * The `?` help overlay (`components/HelpOverlay.tsx`) renders whatever this
 * module returns, so **adding a keybinding anywhere in the TUI means adding a
 * row here** — that is the whole of what keeps the overlay honest. The table is
 * one flat entry per binding rather than prose so a new key is a one-line,
 * append-only diff that does not collide with an unrelated one.
 *
 * `TAB_BINDINGS` is a full `Record<TabType, …>` on purpose: a new tab that adds
 * no row fails to typecheck instead of silently showing an empty help section.
 *
 * Pure by design (utils = compute): no Ink, no React, no I/O.
 */
import { tabs, type TabType } from "../components/tabsConfig.js";

export interface KeyBinding {
  /** The key or keys, as the user would type them (`"↑/↓"`, `"Shift+Tab"`). */
  keys: string;
  /** What pressing it does, phrased as an action. */
  action: string;
}

export interface KeyBindingSection {
  title: string;
  bindings: readonly KeyBinding[];
}

/**
 * The tab accelerators, derived from the tabs the caller says are visible
 * rather than restated, so a new tab's letter appears the moment it is added to
 * the tab bar — and a hidden tab's letter, which does nothing, does not.
 */
function tabAcceleratorBinding(
  visible: readonly { accelerator: string }[],
): KeyBinding {
  return {
    keys: visible.map((tab) => tab.accelerator).join(" "),
    action: "Jump to a tab by its underlined letter",
  };
}

/** Bindings that work wherever no dialog is open, whatever the active tab. */
export function globalBindings(
  visible: readonly { accelerator: string }[] = tabs,
): readonly KeyBinding[] {
  return [
    { keys: "?", action: "Show or hide this help" },
    { keys: "Esc / Ctrl+C", action: "Exit (Esc closes a dialog first)" },
    {
      keys: "Tab / Shift+Tab",
      action: "Move focus: servers → tabs → list → details",
    },
    { keys: "↑/↓", action: "Select a server (server list focused)" },
    { keys: "←/→", action: "Switch tab (tab bar focused)" },
    tabAcceleratorBinding(visible),
    { keys: "c", action: "Connect the selected server" },
    { keys: "d", action: "Disconnect the selected server" },
  ];
}

const DETAILS_SCROLL: readonly KeyBinding[] = [
  { keys: "↑/↓", action: "Scroll the details pane (details focused)" },
  { keys: "PgUp/PgDn", action: "Scroll the details pane a page" },
  { keys: "+", action: "Open the details full screen (details focused)" },
  { keys: "y / w", action: "In a details dialog: copy / save the value" },
];

const LIST_FILTER: KeyBinding = {
  keys: "/",
  action: "Filter the list (Enter keeps it, Esc clears it)",
};

const PANE_SCROLL: readonly KeyBinding[] = [
  { keys: "↑/↓", action: "Scroll (content focused)" },
  { keys: "PgUp/PgDn", action: "Scroll a page" },
];

/** Bindings specific to one tab, shown only while that tab is active. */
export const TAB_BINDINGS: Readonly<Record<TabType, readonly KeyBinding[]>> = {
  info: [
    ...PANE_SCROLL,
    { keys: "e", action: "Edit the advertised roots (content focused)" },
  ],
  auth: [
    ...PANE_SCROLL,
    { keys: "s", action: "Clear OAuth state (disconnects if connected)" },
    { keys: "↑/↓ + Enter", action: "Choose Authorize or Cancel (step-up)" },
    { keys: "a", action: "Authorize a pending step-up" },
    { keys: "c", action: "Cancel a pending step-up" },
    { keys: "y / w", action: "Copy / save the access token" },
  ],
  resources: [
    { keys: "↑/↓", action: "Select a resource (list focused)" },
    { keys: "Enter", action: "Fetch the resource, or fill in a template" },
    LIST_FILTER,
    ...DETAILS_SCROLL,
  ],
  prompts: [
    { keys: "↑/↓", action: "Select a prompt (list focused)" },
    { keys: "Enter", action: "Get the prompt (asks for arguments if any)" },
    LIST_FILTER,
    ...DETAILS_SCROLL,
  ],
  skills: [
    { keys: "↑/↓", action: "Select a skill (list focused)" },
    { keys: "Enter", action: "Verify the skill's digests and frontmatter" },
    LIST_FILTER,
    { keys: "↑/↓", action: "Scroll the details pane (details focused)" },
    { keys: "PgUp/PgDn", action: "Scroll the details pane a page" },
  ],
  tools: [
    { keys: "↑/↓", action: "Select a tool (list focused)" },
    { keys: "Enter", action: "Test the tool" },
    LIST_FILTER,
    {
      keys: "w",
      action: "In the tool's result view: save the result to a file",
    },
    ...DETAILS_SCROLL,
  ],
  messages: [
    { keys: "↑/↓", action: "Select a message (list focused)" },
    { keys: "PgUp/PgDn", action: "Move the selection a page (list focused)" },
    ...DETAILS_SCROLL,
  ],
  requests: [
    { keys: "↑/↓", action: "Select a request (list focused)" },
    { keys: "PgUp/PgDn", action: "Move the selection a page (list focused)" },
    ...DETAILS_SCROLL,
  ],
  logging: PANE_SCROLL,
  subscriptions: [
    { keys: "↑/↓", action: "Select a resource (list focused)" },
    { keys: "Enter", action: "Subscribe to or unsubscribe from the resource" },
    ...PANE_SCROLL,
  ],
  tasks: [
    { keys: "↑/↓", action: "Select a task (list focused)" },
    { keys: "Enter", action: "Fetch the task's result" },
    { keys: "x", action: "Cancel the selected task" },
    { keys: "f", action: "Refresh the task list" },
    { keys: "l", action: "Clear finished tasks" },
    ...DETAILS_SCROLL,
  ],
};

/** Bindings inside the help overlay itself. */
export const HELP_BINDINGS: readonly KeyBinding[] = [
  { keys: "? / Esc", action: "Close this help" },
  { keys: "↑/↓, PgUp/PgDn", action: "Scroll this help" },
];

/**
 * Each tab's bar label, so a section is titled the way the tab bar shows it
 * (`messages` reads "Protocol"). `tabs` lists every `TabType` — which is what
 * makes the cast sound, and `keybindings.test.ts` pins it per tab.
 */
const TAB_LABELS = Object.fromEntries(
  tabs.map((tab) => [tab.id, tab.label]),
) as Record<TabType, string>;

/**
 * The sections the help overlay shows for the active tab: what works
 * everywhere, then what this tab adds, then how to leave the overlay.
 * `visible` is the tab bar's current tabs (default: all of them).
 */
export function keybindingSections(
  activeTab: TabType,
  visible: readonly { accelerator: string }[] = tabs,
): readonly KeyBindingSection[] {
  return [
    { title: "Global", bindings: globalBindings(visible) },
    {
      title: `${TAB_LABELS[activeTab]} tab`,
      bindings: TAB_BINDINGS[activeTab],
    },
    { title: "This help", bindings: HELP_BINDINGS },
  ];
}

/** Width of the widest `keys` across `sections`, for aligning the columns. */
export function keyColumnWidth(sections: readonly KeyBindingSection[]): number {
  let width = 0;
  for (const section of sections) {
    for (const binding of section.bindings) {
      width = Math.max(width, binding.keys.length);
    }
  }
  return width;
}
