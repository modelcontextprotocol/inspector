---
name: pre-push-gate
description: Diagnose a failing stage of this repo's pre-push gate, and run it correctly. Use when npm run local:gate or npm run validate fails; when lint, coverage, a smoke, or Storybook goes red; when a stage behaves differently inside a git worktree; when the whole run times out; or when deciding what to run before pushing.
disable-model-invocation: false
---

# The pre-push gate

**The rule** (stated in [`AGENTS.md`](../../../AGENTS.md)): run `npm run format`
before committing and **`npm run local:gate`** before pushing. `npm run
validate` is the fast inner-loop check and is **not** a substitute — it runs no
coverage gate, no smokes, and no Storybook tests.

The reference for what each stage covers, and the CI-vs-local split, is
[`docs/quality-gate.md`](../../../docs/quality-gate.md). This skill is how to
run it and what to do when it goes red.

## The two commands

```sh
cd <repo root>
npm run format      # auto-fix: core/, scripts/, the shared surface, every client
npm run local:gate  # several minutes
```

The stages it runs, in order, are listed in
[`docs/quality-gate.md`](../../../docs/quality-gate.md) — deliberately in one
place only. That list drifted apart across three copies while this PR was in
review, which is the argument for not making a fourth. `npm run local:gate`
prints each stage as it starts, so the running command is the other reliable
answer.

It is a **strict superset** of GitHub CI (which additionally runs `npm install`,
and runs `coverage` as a parallel job). So the direction that matters holds:
**passing `local:gate` locally means CI's gates will pass.** The reverse does
not.

⚠️ **There is no `npm run ci`.** The gate was renamed to `local:gate` (#2146)
precisely because `npm ci` is a built-in that clean-installs from the lockfile
and does _not_ run this script. `npm run ci` now fails with npm's missing-script
error.

## Verify by exit code, not by grepping output

Prettier failures are `[warn]` lines that match no obvious failure pattern, so a
grep-based check reports success on a red run. Capture the status:

```sh
npm run local:gate; echo "EXIT=$?"
```

⚠️ If you run it as a background task, the harness's "exit code 0" notification
describes the _wrapper_, not the gate — read the `EXIT=` line.

**Background it and then wait for that notification** — do not spend turns
watching it. The gate takes several minutes, and re-running `tail` or an
`echo ok` once per turn until it lands tells you nothing the completion
notification would not have; see [Waiting on long-running
work](../../../AGENTS.md#waiting-on-long-running-work). Waiting out one run this
way cost ~80 consecutive no-op turns on #2250.

## Diagnosing a failing stage

### `verify:format-coverage` / `format:check`

Something isn't formatted, or a tracked source file is covered by no
`format:check` glob. Run the **root** `npm run format` (it covers `core/`,
`scripts/`, the shared surface, and every client) — not a single client's.

### `verify:typecheck-coverage`

A tracked `.ts`/`.tsx`/`.mts`/`.cts` lands in no tsconfig project. Usually a new
top-level file in a client whose build config roots at `./src`; add it to that
client's `tsconfig.test.json` (or the src config's `include`).

### `verify:skills` / `verify:skills:cli`

A `.claude/skills` manifest does not parse, declares no invocation mode, or a
model-invoked skill is missing its eval cases. `verify:skills:cli` is the
authoritative validator and fetches a pinned CLI over the network if you have
none installed — so it is also the one stage that will fail offline.

### `verify:dep-lockstep`

A dependency reaching one `tsc` program from two installs resolves to two
versions. **Align the versions** — bump it in every install that declares it.
Do not raise the heap with `--max-old-space-size`; that hides the class rather
than fixing it.

### `lint`

**There is no warning tier** — every `lint` script runs `--max-warnings 0`, so a
warning fails exactly as an error does. Fix the finding; don't widen a
`globalIgnores` or drop the rule. If a rule genuinely must be waived on a line,
use its inline disable comment **with a one-line justification**.

### `typecheck` passes locally but CI's `tsc -b` fails

⚠️ The **incremental cache** hides type errors. Re-run with `tsc -b --force`, or
in a fresh worktree.

### `coverage`

The per-file gate is ≥90 on **all four** dimensions (lines, statements,
functions, branches). A genuinely unreachable branch is annotated at the source
with a justified `/* v8 ignore … -- <reason> */`, never waved through by
lowering the gate. See `/testing` for the acceptable reasons.

Also check the file is inside a gated directory — the web coverage `include` is
a whitelist, so a module placed outside it falls out of the gate silently.

### `smoke:web*`

⚠️ **An orphaned prod web server from a previous run fakes a rejection.** It
answers the readiness probe with _its_ token, and the deep link comes back
`data-deeplink="rejected"` with no error. Assert the port is free before
blaming the change.

### `local:storybook`

⚠️ In a worktree with a **symlinked `node_modules`** every story file fails on
Vite's `fs.allow`. Do a real `npm install` in the worktree.

### Everything times out at once

⚠️ Two concurrent `npm run local:gate` runs starve each other — ~326 tests time
out at 5s. Run one at a time. (A `pgrep -f "npm run local:gate"` wait loop
matches _itself_ and never exits.)

## Local-only steps

Two stages have no GitHub CI counterpart, each deliberately:

- **`smoke:web:firefox`** — the three browser-driven web smokes again under
  Firefox. Trialled as a CI job and removed (#2086): across a dozen runs it never
  disagreed with Chromium, and `playwright install --with-deps` carries a real
  flake surface. Kept in front of a human about to push instead.
- **`smoke:tui`** — needs a real TTY. It _is_ invoked in CI via `npm run smoke`
  and self-skips there on `process.env.CI`, so it needs no guarding.

A guard (`scripts/lib/workflow-gate.mjs`, run by `npm run test:scripts`) fails
the suite if a workflow invokes a `local:*` script, a non-Chromium engine pass,
or sets `SMOKE_BROWSER` to anything but a literal `chromium`. Don't work around
it — the split is the design.

## Publish-only check

`npm run pack:verify` builds, packs the real tarball, installs it into a clean
throwaway consumer, and drives the installed `mcp-inspector` bin end to end. It
needs **network access**, so it is a local/release check and is in neither
`local:gate` nor CI. Run it when touching packaging (the `files` allowlist,
a bundler `external` list, anything read from disk at runtime).
