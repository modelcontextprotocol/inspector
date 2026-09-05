---
name: testing
description: Run, place and fix tests in this repo. Use when choosing which npm command runs a given suite (web unit, web integration, Storybook, cli, tui, launcher, scripts); when deciding where a new test file belongs — beside its source, under src/test/, or in a client's __tests__/; when a per-file coverage check fails or a v8 ignore is in question; when asking which test tier spawns the built binary rather than importing it; or when rendering, mounting or asserting on Mantine components and their transitions in a test.
disable-model-invocation: false
---

# Testing

**Every change needs tests, and every file must clear ≥90% on lines,
statements, functions, and branches.** That rule and the React/Mantine
conventions live in [`AGENTS.md`](../../../AGENTS.md); this skill is where a
test goes, how to run it, and how to clear the gate.

## Before you write it: does the test need a real server?

**If it does, load the `test-servers` skill now — that is step one, before
choosing a location or writing a line.**

The condition is **"does this test exercise MCP behaviour over a transport?"** —
not which tier it lands in, and not which directory it lands in. It does
whenever the task is: an integration test **that connects**; an end-to-end test
that connects; a smoke that drives a **connected** flow; a coverage gap only
reachable over a real connection; or reproducing a reported bug against a
server.

It does **not** when the test renders a component from fixture props, exercises
a pure function or a parser, or is a boot-only smoke that never connects.
⚠️ **Neither the tier nor the folder decides this.** Only 29 of the 74 files in
`src/test/integration/` touch a server at all — `storage/store-id.test.ts`
validates a string, and `mcp/import/*` parses config files; they sit there for
the node env and the 30s timeout, not because they connect. Likewise
`smoke:launcher` checks `--help`, and `smoke:web` / `smoke:web:browser` only
assert the SPA is served and paints.

When it does apply, the test drives a **real server over a real transport, never
a mock**, and picking the fixture, building it, and connecting with the right
protocol era is a procedure this skill does not carry. Writing one without
`test-servers` means hand-rolling a fixture that already exists, or mocking the
thing the tier exists to avoid mocking.

## Where the test file goes

**Side-by-side by default; `src/test/` only for what can't be co-located; and
the Node clients are different.**

### `clients/web` — side-by-side

`<Name>.test.tsx` (or `.test.ts` for non-React modules) **next to the source**.
Components, hooks, `lib/`, `utils/`. This is the overwhelming majority; a
web-owned test living under `src/test/` instead is a bug.

`clients/web/src/test/` is for the three things that *cannot* be co-located:

1. **Tests of the repo-root `core/` package** → `src/test/core/…`, mirroring the
   `core/` folder layout. `core/` physically lives outside `clients/web/`, is
   consumed via the `@inspector/core` alias, and has no test harness of its own.
   This includes `core/json/*` and `core/client/*`.
2. **The `integration` project** → `src/test/integration/…`, mirroring the
   `core/` source layout (`mcp/`, `mcp/node/`, `mcp/remote/`, `auth/`,
   `auth/node/`, `storage/`). **Placement is the manifest** — any file under that
   folder is picked up by the integration project (node env, 30s timeouts) via a
   folder glob; there is no enumeration to keep in sync. ⚠️ Placement is *not*
   the fixture trigger, though — this folder holds pure parser and storage tests
   alongside the connecting ones. If the test you are adding here **connects**,
   **load the `test-servers` skill first**; the fixture is half of that test.
3. **Shared test infrastructure** — `renderWithMantine.tsx`, `setup.ts`,
   `fixtures/`, `scrollAreaStoryAssertions.ts`.

### `clients/cli`, `clients/tui`, `clients/launcher` — a top-level `__tests__/`

**All** their tests, not beside their source. Their `tsconfig.json` excludes
`**/*.test.*` and their `tsconfig.test.json` includes `__tests__/**/*`, so a
co-located `src/**/*.test.*` lands in **no** tsconfig project and fails
`npm run verify:typecheck-coverage` (#1791).

### Root tooling — `scripts/*.test.mjs`

A new `scripts/*.mjs` helper with pure logic gets a sibling `*.test.mjs`, run by
`npm run test:scripts` (node's built-in runner; the root has no vitest harness by
design). ⚠️ Keep the filename `*.test.mjs` — `node --test` silently **skips** a
file its glob misses and still exits 0.

## Running them

| Scope | From | Command |
| --- | --- | --- |
| Web unit | `clients/web` | `npm run test` (`test:watch` while iterating) |
| Web integration | `clients/web` | `npm run test:integration` |
| Web Storybook play fns | `clients/web` | `npm run test:storybook` |
| CLI | `clients/cli` | `npm run test` (`pretest` builds test-servers + the bin) |
| TUI | `clients/tui` | `npm run test` |
| Launcher | `clients/launcher` | `npm run test` |
| Root tooling | repo root | `npm run test:scripts` |
| Everything, fast | repo root | `npm run validate` |
| The coverage gate | repo root | `npm run coverage` |

There is **no aggregate root `test` script** — each client self-validates.

In unit tests that expect error output, **suppress it from the console**.

## The tiers, shallowest first

unit (`test`, per client) → web integration (`test:integration`, real
transports/servers) → out-of-process (`clients/cli/__tests__/e2e.test.ts`,
spawns the built binary) → smokes through the built launcher (`npm run smoke`) →
Storybook play functions (`test:storybook`) → the published-tarball check
(`npm run pack:verify`, local/release only — needs network).

⚠️ **Depth in that list is not the fixture boundary — connecting is, and it
cuts across the tiers rather than along them.** The **connecting** web
integration tests, the out-of-process CLI tests, the smokes that actually
connect (`smoke:cli`, `smoke:web:app`, `smoke:web:elicit`, `smoke:web:tabs`) and
`pack:verify` need a fixture from `test-servers/`. The rest do not: the pure
tests inside the same integration project, `smoke:launcher`, `smoke:web`,
`smoke:web:browser` (all three stop at boot) and every Storybook play function
(fixture props). **Load the `test-servers` skill as soon as a task puts you on
the connecting side of that line** — whichever tier it sits in.

`validate` runs the per-client `test` scripts — so web **unit** plus cli's
out-of-process `e2e.test.ts`, but **not** web's integration project, which runs
inside the `coverage` gate. CI therefore has no separate `test:integration` step.

## The coverage gate

**Per-file ≥90 on all four dimensions**, CI-enforced, across web, cli, tui and
launcher. New code must clear 90 on every dimension.

Scope notes:

- The **web** coverage `include` (in `clients/web/vite.config.ts`) also covers
  the shared `core/` runtime the browser consumes — `core/mcp`, `core/react`,
  `core/auth`, `core/storage`, `core/logging`, `core/node`, `core/json`,
  `core/client`.
- ⚠️ That `include` is a **whitelist** naming `components`/`hooks`/`theme`/
  `lib`/`utils`/`server`. A module placed **outside** those directories falls out
  of the gate entirely, silently. The documented exceptions are `src/App.tsx`
  (a composition root at ~42% branch coverage — gating it is a dedicated
  decomposition effort) and the `src/main.tsx` / `src/index.ts` bootstraps.
- **CLI** tests run **in-process** by importing `runCli()`
  (`__tests__/helpers/cli-runner.ts`) so `src` is measured; `src/index.ts` is the
  only exclusion. `commander` uses `.exitOverride()` so a parse error throws
  instead of tearing down the test worker.
- **TUI** covers **all of `src/**`, React surface included**. Components mount
  through `ink-testing-library` with the passthrough doubles in
  `__tests__/helpers/`; keypresses are driven through stdin. The only exclusion
  is `src/tui-servers.ts` (a pure re-export, excluded so it doesn't surface as a
  misleading 0/0 row).

### When a `v8 ignore` is justified

A genuinely-unreachable branch is annotated at the source rather than waved
through by lowering the gate. The acceptable reasons are enumerated in
[`AGENTS.md`](../../../AGENTS.md) — do not reach for one that is not on that
list.

## React tests: `renderWithMantine`

**Always render through `renderWithMantine`** (`src/test/renderWithMantine.tsx`)
— it wraps in `MantineProvider` with the project theme. Do not hand-roll a bare
`MantineProvider`; it skips the project theme and the helper's options and drifts
from every other test.

Note the justification has changed and the old one is wrong: it sets
`env="test"`, which makes Mantine skip the animated **render** — but it does
**not** stop the timers. `env` is read only at `Transition.mjs`'s render branch,
while `useTransition()` runs before that check and still schedules real
`window.setTimeout`s (opening a `<Modal>` schedules three 200ms timers). What
prevents a timer outliving its file — and throwing an uncaught
`ReferenceError: window is not defined` that fails the **whole run**, attributed
to an innocent file (#1760) — is the **leaked-timer safety net in
`src/test/setup.ts`**, which is global and covers every unit test however it
renders. The rule stands on consistency, not on timer safety.

- **Forced color scheme:** pass the option —
  `renderWithMantine(ui, { colorScheme: "dark" })` — rather than hand-rolling
  `defaultColorScheme="dark"`.
- **Mid-flight transition state** (e.g. asserting a `data-anim="out"` cell during
  an exit crossfade) is the only reason to use `renderWithMantineTransitions`.
  Pass `settleMs` derived from the component's real animation duration
  (`HEADER_ANIM_MS + 200`), do **not** also use `vi.useFakeTimers()` in that test
  (the auto-settle no-ops under fake timers), and if the test unmounts the tree
  itself use the `unmount()` the helper returns. The mechanism is documented at
  length on the helper — read there before changing it.

## Storybook play functions

Every screen and element component has a `*.stories.tsx`; play functions double
as interaction tests, run headless in CI and in the local gate.

⚠️ **`expect(...)` from `storybook/test` returns a promise.** Storybook
instruments it, so every `expect` in a play function is awaited — as is any
shared helper that wraps one.

## Test servers, not mocks

The tests that drive MCP behaviour over a transport — the connecting integration
tests and the connected smokes — use a real server rather than a mock. **For
those, load the `test-servers` skill to pick, build and run the fixture** —
which showcase config covers the feature, which protocol era to connect with,
how to add a combination that does not exist yet, and why a fixture can keep
serving stale code after an edit. A pure test that happens to live in the
integration project, and a boot-only smoke, need none of it (see the tier list
above).
