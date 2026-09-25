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

It runs **every check** GitHub CI runs (which additionally runs `npm install`,
and runs `coverage` as a parallel job), plus one local-only step. So the
direction that matters holds: **passing `local:gate` locally means every check
CI applies has already passed on your machine** — the strongest predictor of a
green CI there is here, though not a proof (a different OS, and the bare test
pass noted below). The reverse does not hold at all.

One difference in *invocations*, not checks: CI runs each client's unit suite
twice — bare inside `validate`, instrumented inside `coverage` — on two
parallel runners, while the gate runs it **once**, instrumented (#2341). The
gate's first stage is `local:validate`, which is `validate` minus each client's
`test` leg; `npm run validate` itself is unchanged. The reasoning is in
[`AGENTS.md`](../../../AGENTS.md#mandatory-pre-push-gate).

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

### `verify:install-fresh`

An installed package's version disagrees with its install's lockfile — `node_modules`
is older than the tree you pulled. **Run `npm install` at the repo root** (it
cascades into every client) and re-run. This is the first guard for a reason: a
stale install otherwise passes every check and fails later as a behavioral test
reporting the *old* dependency's behavior as a product bug (#2494). Don't
"fix" that test.

### `verify:dep-lockstep`

A dependency reaching one `tsc` program from two installs resolves to two
versions. **Align the versions** — bump it in every install that declares it.
Do not raise the heap with `--max-old-space-size`; that hides the class rather
than fixing it.

### `verify:test-timeouts`

A Vitest project resolves to a wall-clock budget nobody stated, or stopped
loading `vitest.setup.shared.mts`. (A `retry` itself fails at **runtime**, from
that setup file, with a message naming the test — not here.) The shared values live in `vitest.shared.mts` (`TIMEOUTS` /
`INTEGRATION_TIMEOUTS`) and every project spreads one of them — so **raise a
budget there**, not with a per-suite `}, 30_000)` argument, which only moves the
one site and leaves every future file on the default. A per-suite raise is
right only where the work is genuinely different (real cross-process lock
contention, a full OAuth round trip); say so at the site. `retry` stays unset:
it turns a load-induced red into a silent green on the only pre-push gate here.

A **failing test** is a different problem from a budget — read the failure
before reaching for a number. An assertion that races is #1596's class and is
fixed with fake timers or an awaited condition, not with headroom.

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

⚠️ Two `npm run local:gate` runs on one machine starve each other — under four
worktrees ~326 tests timed out at 5s (#2323), and even two collide
deterministically on the web smokes' fixed ports. Since #2339 the gate takes a
**machine-wide lease**, so a second run queues rather than overlapping; if
everything is still timing out at once, look for what is _not_ the gate: a
bypassed lease (`INSPECTOR_SKIP_GATE_LEASE` set in that shell), a bare
`npm run coverage` or `test:storybook` in another session, or Spotlight
indexing a fresh `node_modules` (a `mdworker` storm after `npm install` in a
new worktree pushed the load average to 20 for ten minutes). Do not write a
"wait until the machine is clear" loop — two of them deadlock on each other,
and a `pgrep -f "npm run local:gate"` loop matches _itself_ and never exits.

### Waiting on the lease

A gate that starts with

```
gate-lease: pid 12345 in /Users/you/Projects/mcp-inspector-wt-1, running for 2m10s holds the gate lease, with 2 more gates queued ahead of this one; waiting …
```

is queued behind another worktree's gate. Queued gates start in the order they
arrived (#2473), so this one starts once the holder and the gates ahead of it
have run (it re-checks every 2s and prints `still waiting` once a minute). The
holder's pid and worktree are in the line, so you can decide whether to wait
or to stop that gate. A queued gate that is stopped or killed while waiting
leaves the line at the next waiter's poll; nothing needs cleaning up. A holder that was **killed** — a closed terminal, an
OOM'd session — stops refreshing its lock and is taken over after 30s; nothing
needs cleaning up by hand. The one exception is a dead holder's lock directory
that cannot be removed (a stray file inside it, or permissions): the takeover
fails, the waiter keeps waiting, and the wait runs to its 45-minute cap naming
the path — remove that directory by hand. The cap is a total wait budget, counted
from the waiter's first attempt and not reset as the queue ahead of it drains,
so a queue of healthy gates deeper than it covers — about ten, at ~4.5 minutes
each — reaches it too. So the give-up happens against a live gate that has
hung, a stale lock that would not go away, or a queue that deep; never on its
own.

`INSPECTOR_SKIP_GATE_LEASE=1 npm run local:gate` runs without the lease. It is
for a measurement that needs contention; it does not get a result sooner,
because the queued run finishes before an overlapped one would.

## Local-only step

One stage has no GitHub CI counterpart, deliberately:

- **`smoke:web:firefox`** — the three browser-driven web smokes again under
  Firefox. Trialled as a CI job and removed (#2086): across a dozen runs it never
  disagreed with Chromium, and `playwright install --with-deps` carries a real
  flake surface. Kept in front of a human about to push instead.

A guard (`scripts/lib/workflow-gate.mjs`, run by `npm run test:scripts`) fails
the suite if a workflow invokes a `local:*` script, a non-Chromium engine pass,
or sets `SMOKE_BROWSER` to anything but a literal `chromium`. Don't work around
it — the split is the design.

## Publish-only check

`npm run pack:verify` builds, packs the real tarball, installs it into a clean
throwaway consumer, and drives the installed `mcp-inspector` bin end to end. It
needs **network access**, so it is a local/release check: it is **not** a
`local:gate` stage, and CI runs it only in the `publish` job on a published
GitHub Release — never on a push or PR. Run it when touching packaging (the
`files` allowlist, a bundler `external` list, anything read from disk at
runtime), and as its own step when cutting a release (the `release` skill).
