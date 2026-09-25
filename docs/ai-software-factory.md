# MCP Inspector: Our AI Software Factory

Since **v2.0.0** (2026-07-28), this repo stopped accepting outside pull
requests and moved to a **maintainer + AI-agent** production model: external
contributors file issues, maintainers approve and prioritize them on the
project board, and a coding agent — driven by a human maintainer, working from
this repo's own committed process documentation — takes each approved issue to
a merged PR. This doc explains that model end to end, for anyone who wasn't
part of building it.

It is not a separate tool bolted onto the repo. It **is** the repo's
documented contribution process — `AGENTS.md` plus `.claude/skills/` — written
precisely enough that an agent can execute it for long stretches without a
human confirming each step, and a CI/local gate strict enough that doing so
safely is actually possible.

## The headline change

- **External contributors file issues, never PRs.** `AGENTS.md` is explicit:
  pull requests against this repo are opened by maintainers only — write
  access does not change that. Anyone else opens a detailed issue and a
  maintainer takes it from there.
- **Nearly every merged PR since v2.0.0 was produced by an agent working from
  this repo's own committed rules and procedures**, not by a maintainer typing
  code by hand. The commit trailer that names the agent
  (`Co-Authored-By: Claude ...`) wasn't adopted from day one, so it
  undercounts this — see "Results," directly below, for the actual breakdown.
- **One maintainer account opens nearly all merged PRs** — consistent with
  "maintainers open PRs personally," with the diffs themselves produced by an
  agent working from this repo's own committed rules and procedures, not a
  separate system.
- **The process itself is written down as machine- and human-readable
  procedure**, committed to the repo, loaded automatically by both
  [Claude Code](https://claude.com/claude-code) and the GitHub Copilot CLI, and
  versioned and tested like code.

## Results since v2.0.0 (2026-07-28 → 2026-09-25, ~8 weeks)

In roughly eight weeks this has shipped dozens of merged PRs a week and
worked down a backlog that had been accumulating for most of the project's
life, at a quality bar that held for every one of nine releases (see "The
quality gate," below):

| Metric | Value |
|---|---|
| Releases shipped | 9 (roughly weekly) |
| PRs merged | 268 (~32/week) |
| PRs authored by an agent | 265 (99%) |

Only 3 of the 268 merged PRs weren't agent-authored: 2 Dependabot PRs from
before the cutover fully took effect, and 1 external contributor's PR that was
already in flight. The rest carry an explicit AI co-author commit trailer
(`Co-Authored-By: Claude ...`), except for 46 merged before that trailer
became a standing convention around 2026-09-01 — checked directly, those 46
are ordinary agent-produced commits (same review-round structure, same
maintainer signoff pattern as the trailer'd ones), just predating the
convention. After 2026-09-01, every merged PR carries the trailer.

## Two layers of documentation: rules vs. procedures

| Layer | File(s) | Contains | Loaded |
|---|---|---|---|
| **Rules** | [`AGENTS.md`](../AGENTS.md) (root) | Conventions cited against a diff: branch/version model, dependency placement, testing bar, lint/type rules, React/Mantine conventions, the pre-push gate contract | In full, on every turn — must be self-sufficient |
| **Procedures** | [`.claude/skills/*/SKILL.md`](../.claude/skills) (11 skills) | Multi-step recipes with live commands, IDs, and gotchas: creating an issue, triaging, board mechanics, the PR flow, releases, security advisories | On demand — model-invoked by description match, or explicitly by `/name` |

The split exists because the two layers fail differently. A skill loads
conditionally and can be dropped from context during a long session's
auto-compaction, so anything that must **never** silently disappear (a hard
rule) lives in `AGENTS.md`; anything that's a **recipe** — safely reloadable
from disk whenever it's needed — lives in a skill. See
[Writing a skill](./skill-authoring.md) for how a skill's description is
engineered to reliably fire, and how that reliability is measured rather than
assumed.

| Skill | Purpose | Invocation |
|---|---|---|
| `local-dev` | Install/build/run each client; dependency placement reasoning | model-invoked |
| `project-structure` | Where a new file goes; who owns what surface | model-invoked (background knowledge) |
| `testing` | Test placement, coverage gate, `renderWithMantine` | model-invoked |
| `issue-create` | The create flow: labels, milestone, board card, Status/Priority | model-invoked |
| `issue-triage` | Sweep unboarded issues onto the board; the priority rubric; the board audit | model-invoked |
| `board-ops` | `gh project` mechanics/IDs for boards #28 (v2) and #11 (v1) | model-invoked |
| `pr-flow` | Branching, DCO signoff, screenshots, opening the PR, review round-trip, merge/close-out | model-invoked |
| `pre-push-gate` | Running/diagnosing `npm run local:gate` | model-invoked |
| `release` | Cutting a release: two PRs and a tag, the ledger artifact | name-only (`/release`) — nobody cuts a release by implication |
| `security-advisory` | The private-vulnerability lifecycle | model-invoked |
| `test-servers` | Picking/running fixture MCP servers for manual/automated verification | model-invoked |

Both Claude Code and the GitHub Copilot CLI parse the same skill frontmatter
and read from the same `.claude/skills/` directory — there is no second,
duplicate copy for either agent.

## Issue-driven work, end to end

Nothing happens without a board item. `AGENTS.md`'s invariant: every board
item is a real GitHub issue (the one exception is a private security
advisory, tracked by a draft card until it's published — see below), and
every PR references an issue, no exceptions, regardless of who opens it.

| Line | Board | Branch | Priority field? | Publishes to |
|---|---|---|---|---|
| v2 (active) | [#28](https://github.com/orgs/modelcontextprotocol/projects/28) | `v2/main` → milestone-merge → `main` | Yes | npm `latest` |
| v1 (maintenance, security-only) | [#11](https://github.com/orgs/modelcontextprotocol/projects/11) | `v1/main` (flat, no merge to `main`) | No | npm `v1-latest` |

A v2 issue's lifecycle:

1. **Filed and labeled** — exactly one version label (`v1`/`v2`), exactly one
   type label (`bug`/`enhancement`/`documentation`/`chore`/`question`).
2. **Boarded on #28.** An issue a maintainer creates directly through the
   `issue-create` flow is approved by definition, so it's boarded straight
   into a milestoned **Todo**, skipping to step 5. Everything else — an
   outside reporter's issue, or a maintainer's own issue opened by hand
   instead of through that flow — has no board access behind it and lands
   unmilestoned in **Incoming** instead, regardless of who filed it.
3. **Triaged** *(Incoming path only)* — Priority is scored against a rubric
   and posted as an issue comment, for auditability.
4. **Approved** *(Incoming path only)* — a maintainer assigns a milestone and
   moves the card to Todo. ("Milestoned" *is* "approved" — enforced by an
   automated board audit.)
5. **Work starts** — a branch is cut from `v2/main`, Status → In Progress.
6. **Sent for review** — `npm run local:gate` runs, every commit is signed
   off (DCO), a PR opens against `v2/main` with `Closes #<N>` as its first
   line, Status → In Review.
7. **Reviewed** — a code review is requested and answered, thread by thread.
8. **Merged** — the issue is closed by hand (auto-close doesn't fire, since
   `v2/main` isn't the default branch), Status → Done.

`Done` means the work **shipped** — a merged PR, or a parent issue whose last
sub-issue closed. Anything else that resolves an issue (duplicate, won't-fix,
not-planned, obsolete) gets its card deleted rather than parked in `Done`,
because `Done` is read later as the record of what a milestone actually
delivered.

Priority is scored on two 1–5 axes (severity/impact, urgency/staleness) plus
small, capped signal bonuses — deliberately capped so an outside reporter
can't buy a higher board priority just by asserting one — and the arithmetic
is posted as a visible comment, since both boards are private and a reporter
otherwise has no way to see or contest the reasoning. A board audit
(`issue-triage` skill) then checks roughly a dozen invariants after every
triage pass — double-boarded issues, missing Status/Priority, an
`Incoming` card that already carries a milestone, and so on — expecting every
count to come back zero.

## The PR flow

The [`pr-flow` skill](../.claude/skills/pr-flow/SKILL.md) and the branching
rules in `AGENTS.md` cover:

- **Branch names carry the target version first** — `v2/fix/2071-…`,
  `v1/fix/…` — cut from the matching `*/main`.
- **DCO signoff is a hard merge gate** (`git commit -s`).
- **UI changes require before/after screenshots**, staged in a gitignored
  `pr-screenshots/` folder.
- **A code review is requested and answered per-thread**, with a PR-level
  summary posted in addition (never instead), since inline replies go hidden
  once a fix is pushed.
- **Because v2 PRs target `v2/main`, not the default branch, `Closes #N`
  never auto-closes the issue.** The flow keeps the keyword anyway, for if
  and when `v2/main` reaches `main`, but requires closing the issue and
  moving its card to `Done` by hand on merge — a step the board audit checks
  for directly.

### How a working session gets started

This part isn't encoded anywhere in the repo — no orchestrator, launch
script, or scheduled workflow starts a coding session. As of this writing, a
maintainer still picks an item off the board and opens a session with an
instruction naming the issue, or an intake instruction on the create side:

```
/goal create a PR for #123
/goal create an issue for <problem description>
```

Several sessions typically run at once, each independently working the flow
above end to end — implement, run the gate, push, open the PR, answer review
comments until the review comes back clean, merge, close the issue by hand.

That end-to-end run is only unattended because the launch itself asks for
persistence, not just an instruction. The `/goal` prefix above is Claude
Code's goal mode: rather than treating the prompt as a single request to
satisfy once, it keeps the session working — retrying, adapting, working
around obstacles — until the stated goal is actually reached, so `/goal
create a PR for #123` doesn't stop at the first plausible-looking attempt.
That's what makes launching several sessions and coming back later viable at
all; without it, each session would need a human to notice a stall and
re-prompt it. It cuts the other way too: a goal pursued with real persistence
and an underspecified goal or guardrails is a combination worth being
deliberate about, which is part of why scope is something a human still
states carefully rather than only reviewing at the end (see "Where this is
headed," below).

Because several sessions can reach `npm run local:gate` at close to the same
time, on the same machine, the gate takes a **machine-wide lease**
(`scripts/gate-lease.mjs`, #2339) rather than letting concurrent runs race —
first come, first served. That lease is what made "run several sessions,
walk away, and check back once they've all reported done" viable: without it,
sessions were seeing gate failures caused by resource contention rather than
by real problems in their own change. See
[Testing and the quality gate](./quality-gate.md) for the gate itself.

## Three automated sweeps replace Dependabot PRs

Dependabot used to be the one thing in the repo that could open a PR with no
linked issue and no board card — a standing exception to "every PR references
an issue, no exceptions." Rather than special-case it, the repo turned
Dependabot PRs off entirely and replaced both halves (version bumps and
security bumps) with scheduled workflows that only ever **file issues**:

| Sweep | Workflow → script | Cadence | Files as |
|---|---|---|---|
| Version updates | `dependency-refresh.yml` → `dependency-refresh.mjs` | Monthly | One tracking issue |
| Security updates | `dependabot-alerts.yml` → `dependabot-alerts.mjs` | Daily | One issue per bump |
| SDK release watch | `sdk-watch.yml` → `sdk-watch.mjs` | Nightly | One issue per MCP SDK group it's behind on |

All three still end at an ordinary issue-driven PR — the sweeps only remove
the "remembering to check" step, not the review model.

The SDK-watch workflow additionally runs an LLM-in-CI job (`analyze`) that
reads upstream release notes and posts a summary comment. Because that job
processes untrusted upstream text in public CI, it's split into three jobs by
permission rather than by step (`sweep`: `issues: write`; `analyze`:
`contents: read` only — the one that runs the model; `post`: `issues:
write`), the model is given no `Bash` access at all after two earlier,
narrower tool-whitelists were each found exploitable, and its output is
scanned, uploaded as an artifact, and re-scanned again before being posted —
never passed as a CLI argument. It's a useful reference for anyone adding
another LLM-in-CI step to a public repo: constrain by capability, not by
prompt.

## Security vulnerabilities: a separate, human-gated track

A GitHub security advisory is tracked by a draft board card
(`[GHSA-xxxx-yyyy-zzzz] - <summary>`) rather than a public issue, since a real
issue would disclose the vulnerability before a fix exists. The
[`security-advisory` skill](../.claude/skills/security-advisory/SKILL.md)
covers verifying who actually owns the affected code path before scoring
severity, the private fork used to build a fix, and publishing. **Accepting
and publishing an advisory are explicitly human-only, non-automatable acts** —
never bulk-applied, regardless of how routine the rest of the flow becomes.

## The quality gate

None of the above works without a gate comprehensive enough that a green run
is the strongest predictor there is of a green CI run. `npm run local:gate`
is the mandatory pre-push command:

- **≥90% coverage on lines, statements, functions, and branches, per file**,
  with the only escape hatch a justified, inline `/* v8 ignore ... */` on a
  genuinely unreachable branch.
- **Lint has no warning tier** — `--max-warnings 0` everywhere.
- **`no-floating-promises` at error**, across every scope.
- **Concurrent gates queue on the machine-wide lease** described above, rather
  than racing.
- **`retry` stays permanently disabled** in the test config, so a load-induced
  flake can't pass silently on a second attempt.

See [Testing and the quality gate](./quality-gate.md) for the full stage list
and why one stage is local-only.

## What makes it work

1. **A hard rule that every artifact is issue-linked and board-tracked**, so
   there's always a well-defined unit of work with a recorded approval, a
   priority, and a release bucket.
2. **A gate strict enough that "it passed locally" really does predict "CI is
   green"** — without which unsupervised merges would be reckless.
3. **Rules and procedures are kept separate and engineered for their own
   failure modes** — rules must survive a stale context window; procedures
   must stay reachable through a description that reliably fires, and that
   reliability is measured, not assumed.
4. **Automation that could bypass the review model (Dependabot) was
   redesigned to file issues instead of PRs**, rather than carved out as an
   exception.
5. **A separate, explicitly human-gated track for anything outward-facing or
   irreversible** — accepting or publishing a security advisory, cutting a
   release — so the system automates mechanics, not judgment calls with
   public consequences.
6. **The one LLM-in-CI job that produces a public artifact with no human in
   the loop treats its input as attacker-controlled** and is hardened by
   job-level permission and tool-capability limits rather than by prompt
   instructions.

## Where this is headed

The process above is still maintainer-initiated, one issue at a time: a
person chooses which board item to work next and starts the session (see
"How a working session gets started," above). The stated direction is to
close that gap with an orchestrator that pulls ready work directly from the
board, launches and manages the agent sessions itself, and — after an
automated QA and security pass on top of the existing review and smoke-test
coverage — merges the result. None of that exists in this repo yet; nothing
in `scripts/`, `.github/`, or `.claude/` currently drives session launch or
auto-merge, and this section describes stated intent as of 2026-09, not
shipped behavior.

**The target shape narrows human involvement to two decisions, with
everything between them automatic:**

1. **Deciding an issue is ready to work.** The mechanics of scoring and
   boarding are already agent-driven (the `issue-triage` rubric and board
   audit, above) — but today someone still has to invoke that sweep; a
   UI-filed issue, or one filed by the monthly dependency and nightly SDK
   sweeps, sits unboarded until they do. What stays a human call either way
   is approving an issue out of the Incoming queue: is it worth doing, does
   it match the roadmap, should it be closed instead. Once approved, the
   orchestrator's job is to take it the rest of the way — implementation,
   review, QA and security passes, merge — with no further human step in
   between.
2. **Approving the release.** The `release` skill's ledger-artifact review
   (see the skills table, above) stays the final human sign-off before a
   milestone reaches `main` and ships — everything that produced the
   milestone's contents is meant to already be automatic by the time that
   review happens.

Everything currently manual in between — starting a session, running it to
convergence, merging — is exactly the part the orchestrator is meant to
absorb. It's also why the two things people currently do inside that gap
(steering an agent by leaving comments on its issue, rather than only
reviewing the diff afterward; being deliberate about how a goal is scoped
before handing it to a persistent agent — see above) are worth carrying
forward rather than assuming they disappear: they're how a human's judgment
reaches the work without being the bottleneck that gates every step of it.
