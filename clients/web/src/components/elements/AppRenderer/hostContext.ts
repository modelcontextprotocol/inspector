import type {
  McpUiDisplayMode,
  McpUiHostContext,
  McpUiHostStyles,
  McpUiStyles,
  McpUiStyleVariableKey,
} from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * Resolve the host theme from the DOM. Mantine writes the resolved color
 * scheme to `<html data-mantine-color-scheme>`. Reading it here (rather than
 * capturing React state) keeps the bridge factory's identity stable across
 * theme toggles — the renderer treats a new factory identity as "rebuild the
 * bridge", which would reload a running app's iframe on every theme flip.
 *
 * The attribute is only ever `"light"` or `"dark"` — Mantine resolves
 * `defaultColorScheme="auto"` to the system value before paint and never
 * writes `"auto"` here, so no `auto` branch is needed. The matchMedia
 * fallback only covers the attribute being absent (e.g. a hydration race).
 */
export function currentTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute(
      "data-mantine-color-scheme",
    );
    if (attr === "dark" || attr === "light") return attr;
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Maps the spec's host-style variable keys ({@link McpUiStyleVariableKey}) to
 * the inspector's underlying CSS custom properties. The inspector themes itself
 * with Mantine, so each spec token resolves to the matching Mantine design-token
 * variable (or an `--inspector-*` token layered on top of one). Only a curated
 * subset of the ~90 spec keys is mapped — the ones the inspector has a
 * meaningful equivalent for; the rest are omitted, which the spec allows (hosts
 * may provide any subset).
 */
const STYLE_VARIABLE_SOURCES: Partial<Record<McpUiStyleVariableKey, string>> = {
  "--color-background-primary": "--mantine-color-body",
  "--color-background-secondary": "--inspector-surface-card",
  "--color-background-tertiary": "--inspector-surface-subtle",
  "--color-text-primary": "--mantine-color-text",
  "--color-text-secondary": "--inspector-text-secondary",
  "--color-text-inverse": "--inspector-text-inverse",
  "--color-text-info": "--inspector-log-info",
  "--color-text-danger": "--inspector-log-error",
  "--color-text-success": "--inspector-status-connected",
  "--color-text-warning": "--inspector-log-warning",
  "--color-border-primary": "--inspector-border-default",
  "--color-border-secondary": "--inspector-border-subtle",
  "--font-sans": "--mantine-font-family",
  "--font-mono": "--mantine-font-family-monospace",
  "--font-text-xs-size": "--mantine-font-size-xs",
  "--font-text-sm-size": "--mantine-font-size-sm",
  "--font-text-md-size": "--mantine-font-size-md",
  "--font-text-lg-size": "--mantine-font-size-lg",
  "--border-radius-xs": "--mantine-radius-xs",
  "--border-radius-sm": "--mantine-radius-sm",
  "--border-radius-md": "--mantine-radius-md",
  "--border-radius-lg": "--mantine-radius-lg",
  "--border-radius-xl": "--mantine-radius-xl",
  "--shadow-sm": "--mantine-shadow-sm",
  "--shadow-md": "--mantine-shadow-md",
  "--shadow-lg": "--mantine-shadow-lg",
};

const STYLE_VARIABLE_ENTRIES = Object.entries(STYLE_VARIABLE_SOURCES) as [
  McpUiStyleVariableKey,
  string,
][];

/**
 * Resolve the inspector's design tokens into a {@link McpUiHostStyles} for
 * hostContext, so style-aware apps can theme themselves from the host instead
 * of falling back to their own defaults. Reads the computed value of each
 * mapped CSS variable from the document root — which reflects the active
 * Mantine color scheme — and keeps only the ones that resolve to a non-empty
 * value. Returns undefined when nothing resolves (e.g. a non-DOM/test
 * environment) so we never advertise an empty styles object.
 */
export function currentStyles(): McpUiHostStyles | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return undefined;
  }
  const computed = window.getComputedStyle(document.documentElement);
  const variables: McpUiStyles = {} as McpUiStyles;
  let resolved = false;
  for (const [specKey, sourceVar] of STYLE_VARIABLE_ENTRIES) {
    const value = computed.getPropertyValue(sourceVar).trim();
    if (value) {
      variables[specKey] = value;
      resolved = true;
    }
  }
  return resolved ? { variables } : undefined;
}

/**
 * Spec shape for `hostContext.containerDimensions`. Derived from
 * {@link McpUiHostContext} so the seed and live-push paths share one source of
 * truth and stay in lockstep with the spec types.
 */
export type ContainerDimensions = NonNullable<
  McpUiHostContext["containerDimensions"]
>;

/**
 * Measure the host container an app renders into and return its concrete
 * `{ width, height }` (whole pixels). Returns undefined when the element has
 * no layout box yet (0×0 — e.g. before the iframe is attached, or in a
 * non-DOM/test environment) so a meaningless size is never seeded into
 * hostContext. The return type is the concrete pair rather than the spec's
 * {@link ContainerDimensions} union so callers can compare both fields.
 */
export function measureContainerDimensions(
  element: HTMLElement,
): { width: number; height: number } | undefined {
  if (typeof element.getBoundingClientRect !== "function") return undefined;
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * Read the live host UI state into a {@link McpUiHostContext} for the bridge
 * handshake — the single place that decides which fields the inspector seeds.
 * Optional fields are omitted (not set undefined) so the SDK's diff stays
 * accurate; subsequent live changes are pushed by the renderer's observers as
 * partial `host-context-changed` notifications.
 */
export function snapshotHostContext(
  container: HTMLElement | null,
  availableDisplayModes: readonly McpUiDisplayMode[],
): McpUiHostContext {
  const styles = currentStyles();
  const containerDimensions = container
    ? measureContainerDimensions(container)
    : undefined;
  return {
    theme: currentTheme(),
    // Seed assumes the app opens inline. AppsScreen always mounts the renderer
    // inline (maximize is a later user action), so this holds today; the live
    // displayMode push (AppRenderer's displayMode effect, wired by #1568)
    // carries any subsequent inline↔fullscreen transition. If a caller ever
    // mounts already-maximized, thread the actual mode in here instead.
    displayMode: "inline",
    availableDisplayModes: [...availableDisplayModes],
    ...(styles ? { styles } : {}),
    ...(containerDimensions ? { containerDimensions } : {}),
  };
}
