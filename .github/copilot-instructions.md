# Copilot review instructions — MCP Inspector

> **`AGENTS.md` is the source of truth.** This file is a review-focused distillation of it, kept in sync by hand — see "Keep documentation files up to date" in `AGENTS.md`. Where the two disagree, `AGENTS.md` wins, and the drift is a bug worth flagging in review.

The Inspector ships as one package with three clients (**Web**, **CLI**, **TUI**) over a shared `core/`, consumed via the `@inspector/core` build-time alias. v2 is **not** an npm workspace: the root and each `clients/*` keep their own `package.json` and `node_modules`.

## TypeScript

- **Never use `any`.** Not in types, not in casts, not in generics.
- **Never suppress errors to satisfy the linter or compiler** — no disabling `no-unused-vars` / `no-explicit-any` in config, and no `// @ts-nocheck` or `// @ts-ignore` (`@typescript-eslint/ban-ts-comment` rejects these across every surface).
- **Avoid double casts (`as unknown as T`).** They erase all type safety and usually mean the real type is being worked around. Prefer a type guard, a narrower single cast, or fixing the underlying type. If genuinely unavoidable (a documented gap in a third-party type, or bridging structurally-identical shapes TS can't relate), it **must** carry an inline comment justifying why it's safe and why nothing better exists. An unjustified `as unknown as` is not acceptable in review.
- Prefer inference, type guards, and precise annotations over assertions.
- An `_` prefix is the intentionally-unused marker (`argsIgnorePattern` / `varsIgnorePattern` / `caughtErrorsIgnorePattern`).

## React and UI (web client)

The web client is built from **presentational ("dumb") components** — they take data and callbacks as props and hold display logic only. No data fetching or client state inside them; state comes from the `@inspector/core` hooks wired near the top of the tree. A component that reaches for a store or fetches directly is a review finding.

Styling is **Mantine-first**, in this strict order of preference: component props → theme variants → CSS classes (last resort).

- **Never use inline styles.**
- **Never use raw color literals** — no hex (`#ddd`), no `rgba()`. Use the `--inspector-*` CSS custom properties from `App.css :root` (e.g. `c: 'var(--inspector-text-primary)'`). If no token fits, add one to `:root` first.
- **Avoid `div` and bare HTML for layout.** Use Mantine `Box`, `Group`, `Stack`, `Flex`, `Paper`.
- **Never add a CSS class when the styles can be component props or a theme variant.** Flat CSS properties (margin, padding, background, border, color, font-size) belong in the theme (`src/theme/<Component>.ts`, via `Component.extend()`). `App.css` may contain **only** what the theme cannot express: `@keyframes`, pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships, nested child selectors for third-party HTML output, and styles for native elements (`img`, `iframe`).
- When a theme variant needs a class for nested/pseudo selectors, assign it via `classNames` in the theme extension — never a manual `className` in JSX for theme-styled components.

### The `.withProps()` rule

**Declare a named subcomponent constant via `.withProps()` whenever an inline Mantine element carries two or more _static_ props.** This applies to single-use elements too — "it's only used once" is not an exemption.

- **Static** = a literal configuring **styling, layout, or behavior**: `size="sm"`, `c="dimmed"`, `fw={500}`, `gap="xs"`, `justify="space-between"`, `variant="light"`, `withBorder`, `readOnly`, `striped`.
- **Not counted:** dynamic props (`value`, `on*`, `children`, `key`, `ref`, anything whose value is a variable) — pass these at the call site; and per-instance **content/accessibility** literals (`label`, `description`, `placeholder`, `title`, `aria-label`, `role`) — these never by themselves trigger extraction.

```tsx
const CardContent = Group.withProps({
  flex: 1,
  align: "flex-start",
  justify: "space-between",
  wrap: "nowrap",
});
```

**Legitimate exceptions** (each stays inline, with a one-line comment saying why):

- **`Box`** — does not support `.withProps()`. Use `Group`/`Stack`/`Flex`/`Text`/`Paper`/`UnstyledButton`/`Image` instead, chosen by purpose. A `Box` that genuinely needs a non-flex primitive (`component="iframe"`, `display="grid"`) stays inline.
- **`Accordion`** — a compound, `multiple`-discriminated generic; `.withProps()` loses its JSX call signature and fails to type.
- **Headless, non-`factory()` components** such as `Transition` — no Styles API, so no `.withProps` static at all.
- **`data-*` attributes** — not part of a component's typed props, so excess-property-checked out of a `withProps` literal. Pass at the call site.
- **Anything that isn't a Mantine factory component** — a `react-icons` glyph, another library's component, or a first-party plain `export function`.

### State and effects

- **Never reset or re-sync local state from a prop inside a `useEffect`.** `useEffect(() => setX(prop), [prop])` paints the stale value first and renders twice; it is an error under `react-hooks/set-state-in-effect`.
- Use **`useValueChange(value, onChange)`** (`src/hooks/useValueChange.ts`) — React's documented "adjusting state during render" pattern. It does not fire on the first render; seed the state with `useState`.
- Effects remain correct for real external-system synchronization (DOM measurement, rAF, subscriptions, timers).

### Theme files vs. element components

Both exist and do different jobs. Theme files (`src/theme/<Component>.ts`) customize a Mantine primitive **app-wide**. Element components (`src/components/elements/`) add **domain semantics** on top of primitives.

- Element components import from `@mantine/core`, **not** from `src/theme/` — the theme layer is applied transparently by the provider.
- **Never push domain-specific variant logic into theme files** (annotation types, transport types, …). Domain variants belong to the element component that owns those semantics.

## Where code goes (web client)

**`utils` = functions that compute; `lib` = things that instantiate, adapt, or touch the environment.** If it does I/O or wraps a subsystem it's `lib`; if it's a pure transform it's `utils`.

- `src/utils/` — pure, side-effect-free. Also: pure shared domain types and their constructors; diagnostic `console.warn`/`error` does **not** count as a side effect; type-only imports from `@inspector/core`, and re-exporting pure functions/constants from core, are both fine.
- `src/lib/` — infrastructure, integration, stateful adapters: composes subsystems, wraps the core **runtime**, touches DOM / `window` / `sessionStorage`, or produces side effects.
- Cross-directory imports go **one way: `lib → utils`**, never the reverse.
- `src/types/` is only for ambient `.d.ts` module stubs — not a home for new domain types.
- ⚠️ The coverage `include` is a **whitelist** naming `components` / `hooks` / `theme` / `lib` / `utils` / `server` (plus the `core/*` runtime). A module placed outside those directories silently falls out of the ≥90% gate. Flag new top-level files or new grab-bag directories.

## Tests and the coverage gate

- **All new or modified code needs tests.** The per-file gate is **≥ 90% on all four dimensions** — lines, statements, functions, **and branches** — enforced in CI for `clients/{web,cli,tui,launcher}` and the gated `core/` runtime.
- **Never lower the gate** to accommodate an unreachable branch. Annotate at the source with a justified `/* v8 ignore … -- <reason> */`. Acceptable reasons: happy-dom-inherent paths (Mantine portal mounts, `useMediaQuery` fallbacks, `typeof window` SSR guards), React StrictMode effect-replay blocks, and provably-dead defensive guards. Anything else is a missing test.
- **Suppress expected error output** from the console in tests that exercise error paths.

### Test placement

- **Web:** side-by-side by default — `<Name>.test.tsx` next to the source. A web-owned test under `src/test/` instead of beside its source is a bug. `src/test/` is only for what can't be co-located: tests of the repo-root `core/` package (`src/test/core/…`, mirroring core's layout), the `integration` project (`src/test/integration/…` — placement _is_ the manifest), and shared test infrastructure.
- **CLI / TUI / launcher:** **all** tests live in a top-level `__tests__/` directory. A co-located `src/**/*.test.*` lands in no tsconfig project and fails `verify:typecheck-coverage`.

### Rendering components in tests

- **Always render through `renderWithMantine`** from `src/test/renderWithMantine.tsx`. Never hand-roll a bare `MantineProvider` — that reintroduces a real failure class where a `Transition`/`Modal` timer fires after happy-dom tears down `window` and fails the entire run.
- For a forced color scheme, pass the option — `renderWithMantine(ui, { colorScheme: "dark" })` — rather than a hand-rolled `defaultColorScheme` provider.
- Only when asserting _mid-flight_ transition state, use `renderWithMantineTransitions`, passing `settleMs` derived from the component's real animation duration. Do **not** combine it with `vi.useFakeTimers()`, and use the `unmount()` it returns if the test unmounts the tree itself.

## Gates and PR hygiene

- `npm run format` before committing; **`npm run ci` before pushing** (`validate` → `coverage` → `verify:build-gate` → `smoke` → Storybook). `npm run validate` is the fast inner-loop check and is **not** a substitute — it runs `test`, not `test:coverage`, so it does zero coverage gating.
- **Every PR references an issue**, first body line `Closes #<ISSUE_NUMBER>`.
- **Every PR carries exactly one version label**, `v1` or `v2`, matching its base branch.
- Update the relevant `README.md` / `AGENTS.md` when a change adds, removes, renames, or repurposes a file or folder, changes the structure or tech stack, or introduces a command, dependency, or architectural pattern.

## What to prioritize in review

1. Correctness and security — this backend spawns local processes and proxies outbound requests, so anything touching auth, origin validation, host binding, or the proxy's SSRF controls deserves close reading.
2. Type-safety violations (`any`, suppressions, unjustified double casts).
3. Missing or thin tests against the ≥90% four-dimension gate, and modules placed outside the gated directories.
4. Mantine convention violations — inline styles, raw colors, unnecessary CSS classes, missing `.withProps()` extraction.
5. Docs that contradict the change.
