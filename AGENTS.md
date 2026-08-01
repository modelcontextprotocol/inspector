# Inspector V2

This is an application for inspecting MCP servers. Has three incarnations, Web, TUI, and CLI.

## Project Structure

```
v2/main/
├── clients/
│   ├── web/                            # Web client (Vite + React + Mantine)
│   │   ├── src/                        # Browser source (React app, hooks, components)
│   │   ├── server/                     # Node-only dev/prod backend wiring:
│   │   │                               #   vite-hono-plugin.ts (Hono middleware on the Vite dev server),
│   │   │                               #   server.ts (standalone Hono prod server),
│   │   │                               #   start-vite-dev-server.ts (in-process Vite starter for the launcher),
│   │   │                               #   web-server-config.ts (env parsing + initial-config payload + banner),
│   │   │                               #   sandbox-controller.ts (MCP Apps sandbox HTTP server),
│   │   │                               #   inject-auth-token.ts (embeds the API token into served index.html),
│   │   │                               #   vite-base-config.ts (shared optimizeDeps exclusions),
│   │   │                               #   resolve-bind-host.ts (bind-host POLICY: refuses an
│   │   │                               #     all-interfaces HOST unless DANGEROUSLY_BIND_ALL_INTERFACES;
│   │   │                               #     the all-interfaces DETECTION is core/node/hostUrl.isAllInterfacesHost.
│   │   │                               #     Used by both bind points — web-server-config.ts + vite.config.ts — #1795),
│   │   │                               #   browser-externalized-builtin-gate.ts (build-gate logic that fails
│   │   │                               #     `vite build` on a browser-externalized Node built-in — #1769)
│   │   └── static/                     # sandbox_proxy.html (served by sandbox-controller for MCP Apps tab)
│   ├── cli/                            # CLI client (tsup bundle, @inspector/core alias)
│   ├── tui/                            # TUI client (Ink + React, tsup bundle)
│   ├── launcher/                       # Shared launcher (relative imports into sibling build/ outputs)
├── core/                               # Shared core code (no package.json — consumed via the `@inspector/core` vite alias)
│   ├── auth/                           # OAuth: providers, discovery, OAuthStorage + persist backends;
│   │                                   #   mid-session recovery (challenge.ts WWW-Authenticate
│   │                                   #   parsing, scopes.ts SEP-2350 scope union, oauthUx.ts
│   │                                   #   shared copy, mcpAuth.ts force-reauthorization,
│   │                                   #   issuerBinding.ts SEP-2352 callback-leg failure
│   │                                   #   classification — separates a recoverable
│   │                                   #   "lost authorization state" from a genuine
│   │                                   #   cross-AS issuer mismatch — #1808)
│   │   ├── browser/                    # Browser-side OAuth (sessionStorage, BrowserNavigation)
│   │   ├── node/                       # Node-side OAuth (NodeOAuthStorage, OAuthCallbackServer,
│   │   │                               #   runner-interactive-oauth loopback callback flow)
│   │   └── remote/                     # Remote OAuth storage (delegates to the remote server)
│   ├── client/                         # Install-level client config (`client.json`): browser-safe
│   │                                   #   parse/validate (config-parse.ts) + Node load/save
│   │                                   #   (config.ts, node-persistence.ts), the remote backend
│   │                                   #   (remote.ts), secrets (secrets.ts), and runner.ts.
│   │                                   #   Consumed by both App.tsx trees (web + tui); gated by
│   │                                   #   the web coverage `include`, tests in
│   │                                   #   clients/web/src/test/core/client/.
│   ├── json/                           # JSON utilities and parameter/argument conversion
│   │                                   #   (xMcpHeader.ts: SEP-2243 `x-mcp-header`
│   │                                   #   annotation scan/validation + mirrored-param
│   │                                   #   derivation, used by the Tools tab — #1632;
│   │                                   #   plus `Mcp-Param-*` header building for the
│   │                                   #   wire, used by both `tools/call` paths — #1846)
│   ├── logging/                        # Silent pino logger singleton
│   ├── mcp/                            # InspectorClient runtime + state stores
│   │                                   #   (modernTaskSchemas.ts: SEP-2663 modern Tasks
│   │                                   #   extension wire schemas + normalize/handle helpers,
│   │                                   #   used by the raw-wire tasks/* channel — #1631)
│   │   ├── import/                     # Config import strategies (#1348): client-config parsers
│   │   │                               #   (Claude Desktop/Cursor/Cline/VS Code), registry
│   │   │                               #   server.json parser, strategy registry + well-known
│   │   │                               #   paths, strategy-agnostic merge. Pure/isomorphic;
│   │   │                               #   used by the web file-upload path + /api/import-source.
│   │   ├── node/                       # Node stdio transport factory
│   │   ├── remote/                     # Browser HTTP/SSE transport + remote logger/fetch
│   │   │   └── node/                   # Hono-based remote server backend (used by remote/ above)
│   │   └── state/                      # InspectorClient state stores consumed by core/react/
│   ├── node/                           # Node-only shared helpers: version.ts (readInspectorVersion,
│   │                                   #   walks to the root package.json), hostUrl.ts (shared host
│   │                                   #   normalization + detection — formatHostForUrl brackets IPv6,
│   │                                   #   canonicalUrlHost canonicalizes a bind host the way a browser
│   │                                   #   builds `Origin`, isAllInterfacesHost is the wildcard-bind
│   │                                   #   predicate the guard is built on, isLoopbackHost gates the OAuth
│   │                                   #   callback listener; also stripBrackets. Used across
│   │                                   #   clients/web/server, clients/cli, and core/auth/node — #1795)
│   ├── react/                          # React hooks over the state stores
│   └── storage/                        # File I/O helpers (store-io.ts) used by OAuth persist backends
├── test-servers/                       # Composable MCP test servers + fixtures used by integration tests.
│   ├── src/                            # TypeScript sources. (modern-tasks.ts: SEP-2663 modern
│   │                                   #   Tasks extension runtime + tasks/* Express interceptor
│   │                                   #   + modern_task/modern_input_task tools — #1631)
│   ├── build/                          # Built JS (gitignored). Produced by `npm run test-servers:build`
│   │                                   # so integration tests can spawn the stdio server as a real
│   │                                   # subprocess via `node test-servers/build/test-server-stdio.js`.
│   └── tsconfig.json                   # tsc build config (NodeNext, outDir ./build).
│                                       # The Vite alias `@modelcontextprotocol/inspector-test-server`
│                                       # in clients/web/vite.config.ts points at build/index.js
│                                       # (not src/) so `getTestMcpServerPath()` returns a `.js` path.
│                                       # tsconfig.test.json keeps paths pointing at src for typecheck.
├── docs/                               # Task-oriented guides (mcp-server-configuration.md,
│                                       #   mcp-app-review.md, launcher-config-consolidation-plan.md,
│                                       #   images/). Linked from the root README.
├── scripts/                            # Root build/verify tooling: install-clients.mjs (the
│                                       #   postinstall cascade), the smoke-*.mjs runners,
│                                       #   verify-build-gate / verify-format-coverage /
│                                       #   verify-typecheck-coverage, pack-and-verify.mjs,
│                                       #   and lib/ shared helpers. Prettier-gated via
│                                       #   `format:check:scripts`; its own pure parsers are
│                                       #   unit-tested by `npm run test:scripts` (node --test).
├── specification/                      # Build specification
...
```

## Development setup

v2 is **not** an npm workspace — each client under `clients/*` keeps its own `package.json` and `node_modules` (see the rationale in [specification/v2_cli_tui_launcher.md](specification/v2_cli_tui_launcher.md)). A single `npm install` at the repo root is still all you need: the root `postinstall` (`scripts/install-clients.mjs`) cascades `npm install` into `clients/web`, `clients/cli`, `clients/tui`, and `clients/launcher`.

- **Fresh clone / first-time setup:** run `npm install` at the repo root.
- **After a pull that changes a client's dependencies:** re-run `npm install` at the root to re-sync every client (the `postinstall` cascade handles it).
- The cascade is dev-only: it exits early when the package is installed under `node_modules`, and the published tarball ships only each client's `build/`, so end users are unaffected. Set `INSPECTOR_SKIP_CLIENT_INSTALL=1` to skip it.

After installing, `npm run build` builds all clients. The launcher scripts (`npm run web` / `web:dev`) run the built launcher, so build first; for day-to-day web iteration use `cd clients/web && npm run dev`.

## Contributing

External contributions are accepted as **issues, not pull requests** — maintainers handle design and implementation through a prompt-driven workflow.
If you've already built a change locally, share the **prompt** you used and screenshots if applicable, not a diff. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full policy.

**This applies to org members with write access too, not just outside contributors.** Having permission to push a branch is not authorization to open a PR. Pull requests against this repo are opened by the **repo maintainers** only. Anyone else — including organization members whose write access makes it technically possible — opens a **detailed issue** instead, and a maintainer takes it from there. A detailed issue means: the problem, how to reproduce it, the behavior you expected, and — if you've already prototyped a fix — the prompt you used and any screenshots, rather than a diff.

**Every PR must reference an issue. No exceptions, regardless of who opens it.** The PR body's first line is `Closes #<ISSUE_NUMBER>` (see the [Issue-driven Work Style](#issue-driven-work-style) rules below). A PR with no linked issue has no board card, so the work is invisible to the project board and untracked — if you're about to open one and there's no issue yet, create the issue first. This holds for a maintainer's own one-line fix as much as for a feature.

## Project Status and Direction
* The v1/main branch currently contains the legacy version of the Inspector, which we are creating security fixes for in deprecated maintenance mode. It is **published straight from the branch** to the `v1-latest` npm dist-tag — v1 releases never pass through `main`, and v1 PRs therefore target `v1/main` directly.

* The v2/main branch currently contains the the new version of the Inspector, which is actively being developed and maintained. All new features, bug fixes, and refactors should be implemented in this branch. It acts as the **develop branch**: work accumulates here continuously and is merged into `main` at milestone releases.

* The main branch is the default branch for the repo, and it currently points to the latest v2 release. It is not a development branch, and no new features or bug fixes should be implemented here. It is only used for releases of the v2 Inspector via merge from v2/main, which is what publishes the `latest` npm dist-tag.

## Maintenance Rules

### Keep documentation files up to date
- When adding, removing, renaming, or changing the purpose of any file or folder, update the corresponding entry in the main README.md and/or the related clients/*/README.md
- When the structure of the project, the tech stack, or the developer setup changes, update appropriate README.md files with the details.
- When adding new commands, dependencies, or architectural patterns, update the relevant sections of appropriate README.md files as well.
- When rules for implementation and testing change, update this file AGENTS.md
- **Mirror review-relevant changes into [`.github/copilot-instructions.md`](.github/copilot-instructions.md).** That file is what GitHub Copilot reads when it reviews a PR, and it is a hand-maintained **distillation** of this one — there is no generation step and nothing detects drift, so it goes stale silently and Copilot then reviews against rules we no longer hold.
  - **AGENTS.md remains the source of truth.** Never edit `copilot-instructions.md` alone to change a rule; change it here first, then mirror.
  - **Review-relevant** means anything a reviewer would cite against a diff: the TypeScript rules, the Mantine/React conventions (including the `.withProps()` rule and its exceptions), the `lib` vs `utils` split, test placement, the ≥90% coverage gate and the `v8 ignore` policy, the `renderWithMantine` requirement, and the PR hygiene rules (`Closes #N`, version label). Changing any of these means updating both files in the **same PR**.
  - **Not review-relevant, and deliberately absent** from the mirror: the board recipes and their IDs, milestone and branch-naming mechanics, release and publishing procedure, and the project-structure tree. Copying those in would double the maintenance surface for content no reviewer cites.
  - Keep it a **distillation, not a copy** — it is read on every review, so length has a cost. Prefer tightening the summary over pasting a section wholesale.

### Issue-driven Work Style

All work should be driven by items on the project board.

> **A v2 issue is not "created" until it is labeled `v2`, given a milestone, AND on board #28 with a Status *and* a Priority set.** Labeling alone is not enough — a label is a repo tag, the milestone is a release bucket, and the board is a separate org project. Applying `--label v2` does **not** add the item to the board, and adding it to the board does **not** set a Status or a Priority. All five are distinct steps; do all five (see the recipes below). **Only issues go on the board — never PRs.** A PR still gets the `v2` label, but it is tracked through its linked issue's card (via `Closes #N`), not its own board item.

- Before starting work, check the board for the relevant item.
- **Every board item is a real GitHub issue.** Do not create draft items (board cards with no issue number). If you find work that needs tracking, create an actual issue and add that to the board. Before creating a new issue, check the board for a matching item to avoid duplicates — **never create a duplicate**.
- **Label by version — every issue and every PR, no exceptions.** Each one carries **exactly one** of `v1` or `v2` at creation. There is no unlabeled state and no "decide later": an issue with neither label belongs to no version line, appears in no version-filtered query, and is effectively invisible.
  - `v1` — work targeting `v1/main` (the deprecated line: security fixes only)
  - `v2` — work targeting `v2/main` (active development; the default for anything new)
  Set the label at **create time** — `gh issue create --label v2 ...`, `gh pr create --label v2 ...` — never by backfilling later, since unlabeled items are exactly the ones missed when filtering by version. **If the target version isn't obvious, it's `v2`**: v2 is where all new work goes, and `v1` is reserved for the narrow case of patching the deprecated line. Only ask when the issue is specifically a fix *for released v1 behavior* and it's unclear whether v2 still has the bug. Note the label is a repo tag and is **not** the board — see the callout above; a `v2` issue also needs a board card with a Status **and** a Priority (a `v1` one needs a Status; board #11 has no Priority field).
- **Prioritize every new issue.** Every new issue must have a Priority (Urgent, High, Medium, or Low) set at creation time. Priority is a **board field**, not a label, so it lives on the card and an unboarded issue has nowhere to store it. Derive it with the rubric in [Setting issue priority](#setting-issue-priority) rather than asserting it — an unscored "this feels urgent" is exactly what the rubric exists to replace.
- **Add the issue to the board and set Status and Priority.** After creating an issue, add it to the board for its version — **`v2` → board #28**, **`v1` → board #11** — and set the fields. (PRs are never added to either board — they're tracked through their linked issue's card.) This is the step most easily forgotten because it needs several IDs — copy the recipes below verbatim, and take them from the section for the right board; the two projects' ids are not interchangeable.
  - **New and untriaged → `Incoming`.** This is the **default status for a new item on either board.** An issue nobody has evaluated yet belongs in **Incoming**, not Todo. Todo means a maintainer approved it and it is ready to be picked up; using Todo as the inbox erases that distinction and quietly promotes unreviewed work into the queue. Anything filed by an outside reporter starts in Incoming. Work you are starting immediately goes straight to In Progress.
  - **Priority is v2-only.** Board #28 has a Priority field; board #11 does not. A v1 issue gets a Status and nothing else.
- **Every new issue gets a milestone — no exceptions.** Set it at create time with `gh issue create --milestone <title> ...`. **If the user didn't specify one, default to the current milestone**: the open milestone with the nearest due date. Never leave an issue unmilestoned pending a decision — an unmilestoned issue drops out of release planning silently, the same way an unlabeled one drops out of version filtering. Moving it later is one command; noticing it was never set is the hard part. Get the current milestone with:

  ```sh
  # Open milestones, soonest due date first — the first row is the current one.
  gh api repos/modelcontextprotocol/inspector/milestones --jq \
    'map(select(.state=="open")) | sort_by(.due_on) | .[] | "\(.title)\tdue \(.due_on[0:10])\topen=\(.open_issues)"'
  ```

  Milestones are **release** buckets (`v2.1.0`, `v2.2.0`, …), so pick by *when the work ships*, not by size. If a new issue plainly can't make the current milestone, say so and put it in the next one rather than leaving it blank. Sub-issues normally inherit their parent's milestone — if a sub-task must ship with its parent, they belong in the same one.
- When work begins, create a feature branch and set the item's Status to **In Progress**.
- **Branch names start with the target version segment.** The first path segment must be the version whose base branch the PR targets — `v2/` for work on `v2/main`, `v1/` for work on `v1/main` — followed by the usual type and slug: `v2/ci/restore-claude-workflow`, `v2/fix/oauth-scope-union`, `v1/fix/proxy-ssrf-pin`. Not `ci/restore-claude-workflow`. This keeps the two lines legible in `git branch -a` and in the PR list once v1 and v2 branches coexist on the same remote, and it matches the base branches themselves (`v2/main`, `v1/main`).
- When work is complete:
  - Run `npm run ci` from the root — the mandatory pre-push gate (see [Mandatory pre-push gate](#mandatory-pre-push-gate)). `npm run validate` is the fast inner-loop check and is **not** a substitute: it runs no coverage gate, no smokes, and no Storybook tests.
  - Open a PR against the matching base branch (`v1/main` for v1, `v2/main` for v2) and set the item's Status to **In Review**
  - **Attach screenshots as proof of functionality.** Any change to the web UI or the TUI must show its result: capture before/after screenshots (or a short GIF for an interaction) and put them in a **`pr-screenshots/` folder off the repo root**, creating it if it doesn't exist. That folder is **gitignored** — the images are working artifacts staged for upload, never committed to the source tree — so attach them to the PR body from there rather than referencing an in-repo path. Name them for what they show (`tools-tab-before.png`, `tools-tab-after.png`), not `Screenshot 2026-07-31 at 14.02.11.png`.
  - **Link the PR to its issue — mandatory for every PR, from anyone.** No PR is opened without an issue to reference; if one doesn't exist yet, create it first (labeled and on the board) rather than opening the PR and backfilling. Note also that only the **repo maintainers** open PRs at all (see [Contributing](#contributing)) — everyone else files a detailed issue. The PR body's **first line must be `Closes #<ISSUE_NUMBER>`**. ⚠️ Note: closing keywords only auto-link/auto-close for PRs targeting the repo's **default branch** (`main`). Because v2 PRs target `v2/main` (a non-default branch), `Closes #N` there is only a cross-reference — it will **not** create a hard link or close the issue on merge. (There is no `gh` flag for manual linking — `gh pr edit` has no `--add-issue`; closing keywords are the only mechanism GitHub exposes, and they're gated to the default branch.)
  - **On merge of a v2 PR, manually close its issue and move the board item to Done** (option id `259d6aab`), since auto-close won't fire on `v2/main`. Keep the `Closes #N` line anyway so the issues close automatically if/when `v2/main` is eventually merged to `main`.
- If new tasks are discovered or requested during development, create issues and add them to the board.

## Setting issue priority

Every issue gets a **Priority on its board card**, set when you add the issue to the board. Score it rather than assert it: rate two axes 1–5, add the signal bonuses, and read the total off the band table. The point is that two people triaging the same issue land in the same place, and that the reasoning survives in a form someone can argue with later.

> ⚠️ **There are two different "Priority" fields on an issue page, and they are unrelated. Ours is the one under _Projects → Inspector V2_.**
>
> | Where it appears | What it is | Ours? |
> | --- | --- | --- |
> | **Projects → Inspector V2 → Priority** | The **project board** field on board #28 (`PVTSSF_lADOCt2Azc4BJVxtzg5iJE4`). Urgent/High/Medium/Low, each option carrying its rubric band in the description. | ✅ **Yes — this is the one this rubric sets.** |
> | **Fields → Priority** (above _Projects_) | A GitHub **issue field**, `IFSS_kgDOAdAWeg`. Defined at the **`modelcontextprotocol` org** and shared by every repo in it (typescript-sdk, servers, registry, …), alongside `Effort`, `Start date`, and `Target date`. Created 2026-05-06, `ORG_ONLY`. | ❌ No. Not ours, not repo-scoped. |
>
> They look identical — same name, same four option names — but **nothing syncs them.** Setting one does not set the other, and they will happily disagree (this was first noticed on #1891 showing `Urgent` in Fields and `High` on the board). There is no pass-through, in either direction.
>
> **Never delete the org-level field.** It belongs to the whole org, so removing it would strip Priority from every other `modelcontextprotocol` repo.
>
> **Don't set it either — but do read it.** A value there is a *reporter's* opinion, not a maintainer's assessment, so it is **untrusted input**. It feeds the rubric as a capped +1 signal bonus and nothing more; see [Trust boundary](#trust-boundary-who-can-set-what) below.

**Axis 1 — Severity / impact (1–5).** How bad is it when it happens?

| Score | Means |
| --- | --- |
| 1 | Cosmetic — a typo, a misaligned control, a wording nit. |
| 2 | Minor friction with an easy workaround. |
| 3 | A real feature is broken or missing; the workaround is annoying or partial. |
| 4 | A core workflow is unusable, or the Inspector reports something false about the server under test. |
| 5 | Data loss, a security vulnerability, or a release that is broken on arrival for everyone. |

**Axis 2 — Urgency / staleness (1–5).** How time-sensitive or neglected is it?

| Score | Means |
| --- | --- |
| 1 | No time pressure; nothing waits on it. |
| 2 | Wanted eventually. |
| 3 | Wanted this milestone, or has sat >90 days with no activity. |
| 4 | Blocking other work, or tied to a dated external dependency (an SDK release, a spec deadline). |
| 5 | Blocking a release, or actively hurting users on a published version right now. |

**Signal indicators (bonuses, +1 each — not an axis of their own).** These are corroborating evidence that the two axes may have undercounted, so they adjust the total rather than standing alone:

- Carries a `bug` or security-related label
- Linked to a milestone
- High engagement (many comments or reactions)
- Assigned to someone
- A sub-issue of a larger epic
- The reporter set `Fields → Priority` to **Urgent or High** — **+1, flat, whichever of the two they picked.** It does not map to a band, and `Urgent` earns exactly what `High` earns. See below.

**Bands.** Axes give 2–10 and there are six bonuses, so the total runs 2–16.

| Total | Priority | Meaning |
| --- | --- | --- |
| 12+ | **Urgent** | Drop what you're doing. |
| 9–11 | **High** | Next up after current work. |
| 6–8 | **Medium** | Scheduled normally. |
| ≤5 | **Low** | Nice to have; may sit. |

Note that severity alone doesn't reach Urgent: a 5/5 with no corroborating signals totals 10 and lands **High**. That's deliberate — Urgent is reserved for a severe problem that something *else* also confirms is burning, and a band that everything qualifies for stops carrying information. Override the band when it's plainly wrong, but say why in the issue; a rubric nobody may overrule is a rubric people route around.

Set the resulting level on the board card with the Priority recipe in the [V2 board (#28) `gh` recipes](#v2-board-28-gh-recipes) below.

### Trust boundary: who can set what

**The boards are private** (`public: false`, both #28 and #11 — verified 2026-08-01). The Status and Priority a maintainer assigns are visible only to people with project access: a reporter cannot see them, cannot set them, and will never learn how their issue was scored. Board priority is a maintainers' working queue, not a published commitment.

The org-level `Fields → Priority` is the opposite. It renders on the public issue page and is **not** part of maintainer triage, so any value there is **untrusted** — we didn't put it there, and it carries a preference rather than an assessment.

That asymmetry is the whole reason the reporter's value earns a flat +1 and nothing more:

- **It counts for something.** Someone flagging their own issue is real information about how much it hurts them. Discarding it throws away a signal we'd otherwise have to infer.
- **It cannot decide an outcome.** The bonus is capped, identical for `Urgent` and `High`, and can lift an issue at most one band. Nothing a reporter can type reaches Urgent by itself: Urgent needs 12, so the issue must already sit at 11 on maintainer-assessed axes — at which point the reporter is not the reason.
- **Never map the value across.** A reporter selecting `Urgent` does **not** make the board card Urgent. Doing that would hand queue position to anyone with a GitHub account, and the queue would sort by assertiveness instead of impact.

Don't lean on GitHub's permission gate to enforce this. Whether an outside reporter can set that field today is an implementation detail that can change without notice; the rule holds either way, because it rests on *who assessed the issue* rather than on who was technically able to click.

**Assess board Priority at boarding time**, from the issue as it stands. The reporter's value is one input among several, weighted as above.

## Repository & Project Boards

- **Repo**: https://github.com/modelcontextprotocol/inspector.git
- **Base Branches** — three branches, three distinct roles. Target the one matching the work; never open a PR against `main`.

  | Branch | Role | PRs target it? | Publishes to |
  | --- | --- | --- | --- |
  | `v2/main` | **Develop.** All active v2 work lands here. | **Yes** — every v2 PR | nothing directly; reaches npm via `main` |
  | `main` | **Release.** The repo's default branch; holds the latest released v2. Not a development branch. | **No** — it only receives milestone merges from `v2/main` | `latest` |
  | `v1/main` | **Maintenance.** The deprecated v1 line, security fixes only, no active development. | **Yes** — every v1 PR, directly | `v1-latest`, published straight from this branch |

  So v2 flows `feature branch → v2/main → (milestone) main → npm latest`, while v1 is flat: `feature branch → v1/main → npm v1-latest`, with no merge into `main` at any point. The two lines are published independently under separate dist-tags, which is why a v1 fix does **not** need to be forward-ported to reach users on v1 (`npx @modelcontextprotocol/inspector@v1-latest`).
- **Project Boards**:
  - v2 - https://github.com/orgs/modelcontextprotocol/projects/28 (active board — all new work goes here)
  - v1 - https://github.com/orgs/modelcontextprotocol/projects/11 (legacy inspector version, no new activity except security fixes)

  **Both boards start new items in `Incoming`.** A card only leaves Incoming when a maintainer has looked at it and approved the work — that is what Todo means on either board. The two boards are otherwise separate projects with their own field and option ids; never reuse one board's ids against the other (they are rejected with "option Id does not belong to the field", so the mistake is at least loud).

#### V2 board (#28) `gh` recipes

The board is an **org project**, so all commands use `--owner modelcontextprotocol` and the numeric project `28`. The project node id and the field ids are stable. **The *option* ids are NOT stable — they are regenerated whenever a single-select field's option list is edited** (see the ⚠️ hazard below). If any option id here is rejected, re-fetch the current set with:

```sh
# Swap "Status" for "Priority" to fetch the other field's options.
gh project field-list 28 --owner modelcontextprotocol --format json \
  | jq '.fields[] | select(.name=="Status") | .options'
```

| Thing | ID |
| --- | --- |
| Project node ID | `PVT_kwDOCt2Azc4BJVxt` |
| Status field ID | `PVTSSF_lADOCt2Azc4BJVxtzg5iI8c` |
| Priority field ID | `PVTSSF_lADOCt2Azc4BJVxtzg5iJE4` |

Status option IDs (`--single-select-option-id`) — **last verified 2026-08-01**.

| Status | Option ID |
| --- | --- |
| Incoming | `721a3d4c` |
| Todo | `fbdaf21e` |
| In Progress | `195df262` |
| In Review | `159c8a02` |
| Done | `259d6aab` |

Use **Incoming** for newly filed, untriaged work, **Todo** once a maintainer has approved it and it's ready to pick up, **In Progress** for general active work (regardless of surface), **In Review** once a PR is open, and **Done** on merge. The Incoming/Todo line is the one that matters: Todo asserts approval, so an unreviewed issue parked there is a false claim that someone signed off on it.

Priority option IDs (`--single-select-option-id`) — **last verified 2026-08-01**. Derive the level with the rubric in [Setting issue priority](#setting-issue-priority); don't eyeball it.

| Priority | Option ID | Rubric total |
| --- | --- | --- |
| Urgent | `79628723` | 12+ |
| High | `0a877460` | 9–11 |
| Medium | `da944a9c` | 6–8 |
| Low | `d67ac7ce` | ≤5 |

> ⚠️ **Never add, rename, or remove an option on a single-select board field (Status or Priority) with the `updateProjectV2Field` GraphQL mutation unless you pass every existing option's `id`.** That mutation does a **full replace** of the option list: if you resend options by name/color/description but omit their `id`s, GitHub **deletes all existing options and mints new ones**, which **orphans that field's value on every card on the board** (all items go blank for the field you edited — Status if you were editing Status, Priority if you were editing Priority) *and* invalidates every option id in that field's table above. This has happened once, on Status (required reconstructing ~197 items' statuses by inference). Safe alternatives, in order of preference:
> 1. **Add or rename an option in the GitHub web UI** (Project #28 → the field's settings). This preserves ids of untouched options and never orphans the cards on *other* options. ⚠️ **Deleting is different, in the UI as much as in the API: removing an option blanks that field's value on every card that held it, with no undo and no warning that says so.** Before deleting any option, snapshot the board (see recovery below).
> 2. If you must script it, first `gh api graphql` the current options **with their `id`s**, then call `updateProjectV2Field` echoing back every existing option **including its `id`**, appending only the new one. `ProjectV2SingleSelectFieldOptionInput.id` is an optional `String`, so a mixed list works: echo the `id` for every option that already exists, omit it only for the one being added. Verify afterward that no card lost its value — snapshot `gh project item-list … --format json` before and after and diff, don't just spot-check.
>
> Both the `Incoming` Status option and the Urgent/High/Medium/Low `Priority` options were added this way (#1891), with the before/after diff confirming all 264 cards kept their Status.
>
> `gh project item-add` and `gh project item-edit` are always safe — they set a card's value and never touch the field schema. When option ids change for any reason, **re-verify and update the table above** (and the references in the recipes below and the merge step above).
>
> ### Always snapshot before touching a field's options
>
> One command, and it is the difference between a five-minute restore and reconstructing statuses by inference:
>
> ```sh
> gh project item-list 28 --owner modelcontextprotocol --format json --limit 600 > board-snapshot.json
> ```
>
> ### Recovering from a deleted option
>
> This has now happened twice — once via the API (~197 items, reconstructed by inference) and once via the UI (the `Done` column, 247 items, restored from a snapshot in minutes). With a snapshot the recovery is mechanical.
>
> **The recipe below is written for a deleted *Status* option** — it reads `.status` and writes the Status field id. For a deleted **Priority** option it is the same three steps with two substitutions: read `.priority` instead of `.status` (`gh project item-list --format json` exposes each single-select field under its lowercased name, so both keys are present), and pass the Priority field id `PVTSSF_lADOCt2Azc4BJVxtzg5iJE4` instead of the Status one. Everything else — the snapshot, the grouping safety check, the new-id caveat — applies unchanged.
>
> ```sh
> # 1. Which cards lost their value, and what did they hold?
> gh project item-list 28 --owner modelcontextprotocol --format json --limit 600 > board-broken.json
> jq -r '[.items[]|select(.status==null)|.id]' board-broken.json > lost-ids.json
> jq -r --slurpfile L lost-ids.json '($L[0]) as $lost
>   | [.items[] | select(.id as $i | $lost|index($i)) | .status // "(none)"]
>   | group_by(.) | map({s:.[0],c:length}) | .[] | "was \(.s): \(.c)"' board-snapshot.json
>
> # 2. Recreate the option, echoing every surviving option's id (see above).
> #    NOTE: the recreated option gets a NEW id — the deleted one never comes back.
>
> # 3. Re-apply it to the orphaned cards.
> for id in $(jq -r '.[]' lost-ids.json); do
>   gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$id" \
>     --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id <NEW_OPTION_ID>
>   sleep 0.4
> done
> ```
>
> Step 1's grouping is the safety check: confirm the orphaned set is exactly the cards that held the deleted option, so you don't overwrite a card someone legitimately moved in the meantime. And because the recreated option carries a **new id**, the table above and every reference to it must be updated in the same change — `grep` the old id across the repo. The `Done` id has been `248a3910` and is now `259d6aab` for exactly this reason.

```sh
# 1. Add an issue to the board — prints the item id (PVTI_…); capture it.
gh project item-add 28 --owner modelcontextprotocol --url <issue-url> --format json

# 2. Set its Status (here: In Progress). Use the option id from the table above.
gh project item-edit \
  --project-id PVT_kwDOCt2Azc4BJVxt \
  --id <item-id-from-step-1> \
  --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c \
  --single-select-option-id 195df262
```

The full one-liner for a **new** issue — add it, then set Status and Priority (both are required; here Incoming + Medium):

```sh
ITEM_ID=$(gh project item-add 28 --owner modelcontextprotocol --url <issue-url> --format json --jq '.id')
# Status → Incoming
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id 721a3d4c
# Priority → Medium
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iJE4 --single-select-option-id da944a9c
```

Each `item-edit` sets **one** field, so setting both takes two calls — there is no combined form.

For an issue **already on the board** (moving an existing card, e.g. to **In Review** when its PR opens, or re-scoring its Priority), look its item id up by issue number instead of re-adding it. Keep `--limit` above the board's item count (~265 as of 2026-08-01) — past it `item-list` truncates silently, `select` matches nothing, and `item-edit --id ""` fails with an opaque node-resolution error rather than saying the limit was too low:

```sh
# --limit must stay above the board's item count (~265 today) — past it the
# list truncates silently and item-edit fails with an opaque node-resolution error.
ITEM_ID=$(gh project item-list 28 --owner modelcontextprotocol --format json --limit 500 \
  --jq '.items[] | select(.content.number==<ISSUE_NUMBER>) | .id')
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id 159c8a02
```

#### V1 board (#11) `gh` recipes

The v1 line takes **security fixes only**, so this board sees little traffic — but a v1 issue still gets a card, and it starts in **Incoming** like a v2 one. Board #11 is a separate org project with **its own ids**; none of the #28 ids above work here.

| Thing | ID |
| --- | --- |
| Project node ID | `PVT_kwDOCt2Azc4BA5sz` |
| Status field ID | `PVTSSF_lADOCt2Azc4BA5szzgzkS-g` |

Status option IDs — **last verified 2026-08-01**.

| Status | Option ID |
| --- | --- |
| Incoming | `831820cf` |
| Todo | `f75ad846` |
| In Progress | `47fc9ee4` |
| In Review | `0439b2bf` |
| Done | `98236657` |

There is **no Priority field on this board** — the priority rubric applies to v2 only. Don't try to set one here; the field id doesn't exist.

```sh
# Add a v1 issue to board #11 and put it in Incoming.
ITEM_ID=$(gh project item-add 11 --owner modelcontextprotocol --url <issue-url> --format json --jq '.id')
gh project item-edit --project-id PVT_kwDOCt2Azc4BA5sz --id "$ITEM_ID" --field-id PVTSSF_lADOCt2Azc4BA5szzgzkS-g --single-select-option-id 831820cf
```

The ⚠️ option-deletion hazard, the snapshot rule, and the recovery recipe above apply to **this board too** — same mutation, same failure mode, different ids. Note that three cards on #11 already carry no Status; that predates the `Incoming` addition (verified by before/after diff on 2026-08-01) and is not evidence of an orphaning event.

### Always test new or modified code
- Ensure all code has corresponding tests
- Ensure test coverage for each file is at least 90%
- In unit tests that expect error output, suppress it from the console
- Run unit tests with `npm run test` (or `npm run test:watch` during development) from `clients/web/`
- Run CLI tests with `npm run test` from `clients/cli/` (builds test-servers + CLI bin first via `pretest`)
- Run TUI tests with `npm run test` from `clients/tui/`
- Run launcher tests with `npm run test` from `clients/launcher/`
- Run the root tooling's own tests with `npm run test:scripts` from the root — `node --test "scripts/**/*.test.mjs"`, node's built-in runner (the root has no vitest harness by design). A new `scripts/*.mjs` helper with pure logic gets a sibling `*.test.mjs`; keep the filename `*.test.mjs`, since `node --test` silently **skips** a file its glob misses and still exits 0 (`verify:typecheck-coverage` guards against exactly that).
- **The test tiers, shallowest first:** unit (`test`, per client) → web integration (`test:integration`, real transports/servers) → out-of-process (`clients/cli/__tests__/e2e.test.ts`, spawns the built binary) → smokes through the built launcher (`npm run smoke`) → Storybook play functions (`test:storybook`) → the published-tarball check (`npm run pack:verify`, local/release only — needs network). `validate` runs the per-client `test` scripts — so web **unit** plus cli's out-of-process `e2e.test.ts` (it's part of cli's `test`), but **not** web's integration project, which runs inside the `coverage` gate. Everything from `smoke` rightward is `npm run ci` only, and is described under [Mandatory pre-push gate](#mandatory-pre-push-gate).
- The repo root has no aggregate `test` script — each client self-validates, so run `npm run validate` from the root (all clients, fast) or `cd clients/<name> && npm run validate` (one client). Each client still exposes its own `test` / `test:coverage` for quick iteration.
- **`validate` is fast: it runs `test`, not `test:coverage`.** The coverage gate (slower — adds v8 instrumentation, and for web the integration project) is a **separate** top-level `npm run coverage` (and per-client `coverage:web` / `coverage:cli` / `coverage:tui` / `coverage:launcher`, each delegating to that client's `test:coverage`). Run `npm run coverage` when you want to reproduce the gate locally before pushing. **CI runs `coverage`** on every push (#1550): the per-file ≥90 gate is CI-enforced, so a PR that drops any file below 90 on lines/statements/functions/branches fails the job. CI runs `validate` (fast) for format/lint/build/unit tests, then `coverage` for the instrumented gate. Because web's `test:coverage` already runs the integration project, CI has no separate `test:integration` step — the integration paths are exercised inside the coverage gate.
- Each client's `test:coverage` enforces a **uniform per-file gate of ≥ 90 on all four dimensions** — lines, statements, functions, and branches — across `clients/web`, `clients/cli`, `clients/tui`, and `clients/launcher` (CI enforces this gate). This is the result of a codebase-wide audit: the branch floor was first lifted 50 → 70 for web (#1271), then the whole gate raised to 90 with real tests added for every outlier. Genuinely-unreachable branches are **not** waved through by lowering the gate — they are annotated at the source with a justified `/* v8 ignore … -- <reason> */` comment. Acceptable reasons are happy-dom-inherent paths (Mantine portal mount points, `useMediaQuery` fallbacks, `typeof window` SSR guards), React StrictMode effect-replay blocks, and provably-dead defensive guards (e.g. a `?? fallback` for a value the types guarantee non-null, or a `Select.onChange` receiving a value outside the allowed list). New code must clear 90 on every dimension; reach for a justified `v8 ignore` only when a branch is genuinely impossible to exercise. The web coverage `include` (in `clients/web/vite.config.ts`) covers the shared `core/` runtime consumed by the browser — `core/mcp`, `core/react`, `core/auth`, `core/storage`, `core/logging`, `core/node`, **`core/json`, and `core/client`** (the last two folded in by #1689). When adding a `core/json/*` or `core/client/*` module, its tests live under `clients/web/src/test/core/…` and are gated the same ≥90 way.
- The **same per-file gate** is enforced for the CLI and TUI (#1484), not just web:
  - **CLI** (`clients/cli`): tests run **in-process** by importing `runCli()` (see `__tests__/helpers/cli-runner.ts`) so `clients/cli/src` is measured under v8 instrumentation. A thin out-of-process layer (`__tests__/e2e.test.ts` + `scripts/smoke-cli.mjs`) still spawns the built binary for the shebang/`process.exit` paths; `src/index.ts` (binary bootstrap) is the only coverage exclusion. `commander` uses `.exitOverride()` so a parse error throws instead of tearing down the test worker.
  - **TUI** (`clients/tui`): the gate now covers **all of `src/**`, React surface included** — the former interim exclusion of the Ink components, `App.tsx`, and `hooks/` was lifted in #1501. Components mount through `ink-testing-library` with the `ink-scroll-view` / `ink-form` passthrough doubles in `__tests__/helpers/`, `App.tsx` mounts against a controllable mock of the `@inspector/core` surface, and keypresses are driven through stdin. The **only** coverage exclusion left in `clients/tui/vitest.config.ts` is `src/tui-servers.ts` — a pure re-export + type alias of core's server resolver with no runtime statements of its own (the logic is measured in `core/` via the web suite; `tui-servers.test.ts` still exercises it behaviorally, and it's excluded only so it doesn't surface as a misleading 0/0 row). Any new logic under `clients/tui/src`, React or not, is held to the gate automatically.
- Run `npm run test:integration` (also from `clients/web/`) for the InspectorClient + transport + auth integration suite. It runs under a separate `integration` vitest project in node env (no happy-dom) with 30s timeouts. The script builds `test-servers/` first via `tsc -p ../../test-servers --noCheck` so the stdio MCP test server can be spawned as a real subprocess. CI does not run `test:integration` as its own step — the integration project is covered by the CI `coverage` gate, whose web `test:coverage` runs `--project=unit --project=integration --coverage`.
- Test files live alongside the source as `<Name>.test.tsx` (or `.test.ts` for non-React modules). Integration tests live under `clients/web/src/test/integration/`, mirroring the `core/` source layout (`mcp/`, `mcp/node/`, `mcp/remote/`, `auth/`, `auth/node/`, `storage/`). Any test file under that folder is automatically picked up by the `integration` vitest project (node env, 30s timeouts) via the folder glob in `vite.config.ts` — placement is the manifest, there is no enumeration to keep in sync. Tests outside the folder run in the `unit` project (happy-dom). When adding a new test for, e.g., `core/mcp/remote/foo.ts`, put it at `src/test/integration/mcp/remote/foo.test.ts`.
- **Test placement: side-by-side by default, `src/test/` only for what can't be co-located.** These look like competing conventions but aren't — the split is: *tests live beside their source, **except** tests for the repo-root `core/` package (which lives outside `clients/web/`) and shared test scaffolding — both of which live under `src/test/`, with `core/` tests mirroring the `core/` layout and integration tests under `src/test/integration/`.*
  - **Side-by-side (`<Name>.test.tsx` next to the source) — the default for web's own `src/` code.** Components, hooks, `lib/`, `utils/`. This is the overwhelming majority; a web-owned test living under `src/test/` instead of beside its source is a bug (fixed one such straggler, `downloadFile.test.ts`, in #1776).
  - **`src/test/` — the three things that *cannot* be co-located:** (1) tests of the repo-root **`core/`** package (`src/test/core/…`, mirroring the `core/` folder layout — `core/` physically lives at `/core` outside `clients/web/`, is consumed via the `@inspector/core` alias, and has no test harness of its own, so co-locating would pollute the shared isomorphic package with web-only test infra); (2) the **`integration`** vitest project (`src/test/integration/…`, node env, 30s — placement *is* the manifest, see above); (3) **shared test infrastructure** (`renderWithMantine.tsx`, `setup.ts`, `fixtures/`, `scrollAreaStoryAssertions.ts`) — not tests *of* a source file, so nothing to sit beside.
  - **The above is web only.** The Node clients (**cli, tui, launcher**) keep **all** their tests in a top-level **`__tests__/`** dir, not beside their source — their `tsconfig.json` excludes `**/*.test.*` and their `tsconfig.test.json` includes `__tests__/**/*` (plus, for launcher, its root `vitest.config.ts`), so a co-located `src/**/*.test.*` lands in **no** tsconfig project and fails `npm run verify:typecheck-coverage` (#1791). Put a new cli/tui/launcher test under `__tests__/`.
- Use `renderWithMantine` from `src/test/renderWithMantine.tsx` to render components — it wraps in `MantineProvider` with the project theme. It sets `env="test"` so Mantine renders transitions synchronously (no internal `setTimeout`); this prevents a `Transition`/`Modal` timer from firing after happy-dom tears down `window` at end-of-run and failing the whole run with an uncaught `ReferenceError: window is not defined` (#1760). **Always render through `renderWithMantine`; do not hand-roll a bare `MantineProvider` in a test** (that reintroduces the leak class). To exercise a **forced color scheme** (e.g. the `useComputedColorScheme` dark branch) pass the `colorScheme` option — `renderWithMantine(ui, { colorScheme: "dark" })` — instead of hand-rolling a `defaultColorScheme="dark"` provider (#1786). Only when a test must assert *mid-flight* transition state (e.g. a `data-anim="out"` cell during an exit crossfade) use `renderWithMantineTransitions` (real transitions). Such a test can leak the #1760 class because waiting for one cell to unmount does **not** settle a concurrent *enter* (a completed enter leaves no DOM signal to `waitFor`), so the helper **automatically drains the in-flight animation after the test**. The rule for using it: pass `settleMs` derived from the component's real animation duration — its `Transition` `duration`/`exitDuration` plus any `enterDelay`/`exitDelay` plus rAF slack — e.g. `renderWithMantineTransitions(ui, { settleMs: HEADER_ANIM_MS + 200 })` (so the window can't silently become insufficient when that duration changes); do **not** also use `vi.useFakeTimers()` in the same test (the auto-settle no-ops under fake timers — it warns, but anything the test left pending on the *real* clock is then unprotected, so the test depends on which clock was installed at teardown); and if the test unmounts the tree itself, use the `unmount()` the helper returns (it drops that tree from the settle's liveness check, while still draining — a bare mid-body `cleanup()` on a still-armed tree would trip the check). The mechanism behind all three — why the drain is `act`-wrapped, the fake-timer hazard, the `afterEach`-before-`cleanup()` ordering and its `container.isConnected` self-checks, and the exported `settleTransitions(ms)` for manual mid-body settling — is documented at length on the helper in `renderWithMantine.tsx`; read there before changing it.

### Responding to Code Reviews
- When asked to respond to a code review of a PR,
  - it is not necessary to implement all suggestions
  - you are free to implement suggestions in a different way or to ignore if there is a good reason
  - after making the changes, respond to each review comment with what was done (or why it was ignored)

### Mandatory pre-push gate
- ALWAYS do `npm run format` before committing — the **root** `format` auto-fixes `core/` (`format:core`), the root `scripts/` tooling (`format:scripts`), the root "shared" surface (`format:shared` — `test-servers/src/**`, `vitest.shared.mts`, the root `eslint.config.js`), and every client's scope in one shot. Every **client** format glob uses the uniform extension set `*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` (#1792) so a new-extension file can't slip the gate; `core/` stays `{ts,tsx}` and the shared surface `{ts,tsx,mts,cts}` (their surfaces can't hold the other extensions), and `npm run verify:format-coverage` (the first step of `validate`, #1792) is the backstop — it fails if any tracked source file is left uncovered by a `format:check` glob regardless of which glob was expected to catch it. `validate` runs `format:check` (the non-fixing variant, including `format:check:core`, `format:check:scripts`, and `format:check:shared`) and will fail in CI on any unformatted file, so always run the auto-fixer first rather than letting `format:check` catch it.
- **`npm run ci` is the mandatory pre-push command** — it mirrors `.github/workflows/main.yml` (minus `npm install`): `validate` → `coverage` → `verify:build-gate` (the #1769 browser-externalized-builtin build gate) → `smoke` → Storybook play-function tests (installs Playwright chromium if needed). It now runs **`npm run coverage`**, the per-file ≥90 gate (lines/statements/functions/branches) that CI enforces — so `npm run ci` is a true superset of GitHub CI, and passing it locally means CI's gates will pass. Expect several minutes. **`npm run validate`** remains the fast inner-loop check during development (unit tests only — no coverage gate, no smoke, no Storybook), but it is **NOT** an acceptable substitute for `npm run ci` before pushing: `validate` runs `test`, not `test:coverage`, so it does **zero** coverage gating. Skipping the gate is how a push passes every fast local check and still fails CI (this exact gap broke PR #1601 on a function-coverage regression).
- ALWAYS do `npm run format` before committing, then **`npm run ci`** before pushing. From the repo root, `validate` runs **`verify:format-coverage` first** (the #1792 guard — asserts every tracked source file is covered by a `format:check` glob), then **`verify:typecheck-coverage`** (the #1791 guard — asserts every tracked `.ts`/`.tsx`/`.mts`/`.cts` in each gated Node client, plus the non-client first-party TS like `core/` and `test-servers/src`, lands in a tsconfig project), then **`test:scripts`** (the guard's own parser unit tests, `node --test`), then the **`core/` gate** (`validate:core`), then chains the four per-client validations (`validate:web` → `validate:cli` → `validate:tui` → `validate:launcher`); each client delegates to its own `npm run validate` in its own folder (no coverage — fast). Every client is self-validating and the top level just chains them, building each client's bundle along the way (no cross-client build dependencies).
  - **`validate:core` is the root-owned format + lint gate (#1689, widened in #1778 and #1767).** Each client's `prettier`/`eslint` is scoped to its own dir, so nothing reached `core/`, the root `scripts/`, or the root "shared" surface before — `validate:core` closes that: it runs `format:check:core` (`prettier --check "core/**/*.{ts,tsx}"`) + `format:check:scripts` (`prettier --check "scripts/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"`, the root build/verify tooling — #1778) + `format:check:shared` + `lint:core` (`eslint "core/**/*.{ts,tsx}"` via the **root** `eslint.config.js`) + `lint:shared`. Use `npm run format:core` / `npm run format:scripts` / `npm run format:shared` to auto-fix (all folded into the root `format`). The **shared surface** (#1767) is `test-servers/src/**/*.{ts,tsx,mts,cts}`, the root `vitest.shared.mts`, and the root `eslint.config.js` — first-party code no client's `eslint .` / `prettier` reaches; it is both prettier-gated (`format:check:shared`) and eslint-gated (`lint:shared`, via a second `files` block in the root `eslint.config.js` scoped to Node globals). The `scripts/` gate is prettier-only — the root has no eslint config for `.mjs`. The root carries prettier/eslint as devDependencies for this; `core/` is isomorphic (browser + Node globals, no JSX today — the `{ts,tsx}` glob future-proofs against a `core/**/*.tsx`). The root `eslint.config.js` honors an `_`-prefix as the intentionally-unused marker (`argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: '^_'`). **prettier is pinned to an exact version** (not a caret) in all five `package.json`s (#1790) so the gate's verdict can't shift with an in-range patch bump.
  - **cli and tui now typecheck their `src` (#1689).** Their `build`/`test` run through esbuild (no type check), so each has a `typecheck` script folded into `validate`. Their `tsconfig.json` matches `clients/web/tsconfig.app.json`'s module/lib *resolution* options — DOM lib, `moduleResolution: bundler`, and **no** `noUncheckedIndexedAccess` (web's app config does not extend `tsconfig.base`, so re-enabling it would surface `core/` issues web never gates) — so the imported `core/` sources are validated the same way web validates them. It does **not** mirror web's extra strictness flags (`noUnusedLocals`, `verbatimModuleSyntax`, ES2023 target, …), so cli/tui's own `src` is checked slightly more loosely than web's. `core/` itself still typechecks through web's `tsc -b`.
  - **The `__tests__` dirs are typechecked too (#1791).** The src-only `tsconfig.json` excludes `**/*.test.*`, so each of cli, tui, and launcher carries a **`tsconfig.test.json`** — extending the build config, `noEmit`, including `__tests__/**/*` (only the tests root the project; tsc pulls in the `src` they import, and the src-only config already validates all of `src` without the test-only aliases) and adding the test-only path aliases that resolve what vitest resolves via `vitest.shared.mts`. The alias set differs per client: **cli's is the widest** (`@modelcontextprotocol/inspector-test-server` → `test-servers/src`, the `@inspector/core/*` deep paths, express/vitest — cli is the only one importing the test-server package); **tui's** carries only the `@inspector/core/*` + react/vitest redirects; **launcher's** has **no** `paths` at all — it's a plain `rootDir: "."` sibling of the build config (whose `rootDir: ./src` is what rejects the tests). Each client's `typecheck` script runs **both** projects (`tsc -p tsconfig.json && tsc -p tsconfig.test.json`) so running it standalone means the same thing everywhere (launcher's `build` also `tsc`s `src`, but `typecheck` doesn't rely on that). cli additionally carries `@types/express` (devDep) so the transitively-aliased test-server source typechecks, mirroring `clients/web` (cli's `tsconfig.test.json` also names `test-servers/src/server-composable.ts` explicitly — a bin entry the barrel doesn't import, so nothing else gives it a tsc pass). The client **config files** are typechecked too: cli's/tui's (`vitest.config.ts`, `tsup.config.ts`, tui `dev.ts`) are folded into each src `tsconfig.json`'s `include`; launcher's `vitest.config.ts` goes in its `tsconfig.test.json` instead (again the `rootDir: ./src` reason). Note the gate checks mock **implementations and return types** (typing a `vi.fn<T>()` against a real signature keeps its `mockResolvedValue`/impl in sync) but **not** `toHaveBeenCalledWith(...)` arguments — vitest types those to accept anything regardless of the mock's type parameter. **`npm run verify:typecheck-coverage`** (`scripts/verify-typecheck-coverage.mjs`, run as the second step of `validate` right after `verify:format-coverage`) is the durable guard for this invariant: it runs each client's `typecheck` projects with `tsc --listFilesOnly`, unions them, and fails on any tracked `.ts`/`.tsx`/`.mts`/`.cts` that lands in no project — for every gated Node client, which it discovers from disk (each `clients/*` is enrolled through its `typecheck` script's projects, or — for a `tsc -b` client like `clients/web` with no `typecheck` script — through its `tsconfig.json` `references`), so a new client is covered without editing the guard — the typecheck analog of `verify:format-coverage`, since a project only reaches the files its `include` names plus their transitive imports, so a new top-level file (launcher especially, whose build `rootDir: ./src` rejects package-root files) can otherwise fall out silently. Like its sibling it also asserts the gate is *wired* (each client's typecheck pass is reachable from its `validate` — its `typecheck` script for cli/tui/launcher, or a real `tsc -b` for web — and the root chain runs each client's `validate`), so it can't stay green while measuring a pass nothing invokes. It asserts the same of **`test:scripts`** — its own parser tests — on three axes: reachable from the root `validate`, a **non-empty** tracked `scripts/**/*.{test,spec}.*` set, and **every one of those files matched by a glob harvested across the scripts reachable from `test:scripts`** (so a delegating `test:scripts` still measures correctly). The third axis exists because `node --test` silently *skips* a file its glob misses and still exits 0 — a rename to `*.spec.mjs` would shrink the suite with a green run. Beyond the clients it also covers, **deny-by-default**, the first-party TS no client owns — everything tracked outside `clients/*` (`test-servers/src/**`, the root `vitest.shared.mts`, **all of `core/`**, and any new top-level TS location) must land in the *global* union of client projects (cli aliases the test-server source; web's enrolled projects include `core/`). So a `core` `*.tsx` web's `include` doesn't reach, or an unimported `test-servers/src` bin entry, can't ship uncompiled-but-unchecked. The one "listed but unchecked" tier the guard structurally can't see — a per-file `// @ts-nocheck` — is owned by a different gate: `@typescript-eslint/ban-ts-comment` rejects it across every surface (`lint:core`, `lint:shared`, and each client's `eslint .`). The guard's own pure parsers (`scripts/lib/npm-scripts.mjs` + the exported helpers of `verify-typecheck-coverage.mjs`, whose execution is behind a `main()` so importing it for tests doesn't run it) are **unit-tested** — `npm run test:scripts` (node's built-in `node --test`, in `validate`; the root has no vitest harness by design) runs table-driven cases, one per rule the guard's parsers encode, and the guard itself enforces that this stays wired (above).
  - The one CLI nuance: `clients/cli`'s out-of-process `e2e.test.ts` spawns the built binary, so its `test` **builds first** via `pretest` (`test-servers:build && build`). To avoid building it twice, `clients/cli`'s `validate` folds that in — it is `format:check && lint && typecheck && test` with **no** separate `build` step (the other clients, whose tests don't spawn their bundle, keep an explicit `build`). `validate:web`/`validate:tui`/`validate:launcher` are the uniform `format:check && lint && (typecheck &&) build && test`. (#1778, #1789, #1792) `clients/web`'s `format`/`format:check` covers `src`, `server`, `.storybook`, and its top-level configs (the uniform `*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` glob — `vite.config.ts`, `tsup.runner.config.ts`, `eslint.config.js`, …), not just `src`, so the Node backend, Storybook config, and Vite/build config are prettier-gated too; `clients/launcher`'s covers `src`, `__tests__`, `scripts`, and its top-level configs (the `*.` top-level glob is non-recursive, so each nested dir — `.storybook`, `scripts` — is named explicitly). The `verify:format-coverage` guard (#1792) enforces that this coverage stays complete.
  - **`npm run coverage`** is the per-file ≥90 gate and is now part of `npm run ci` — never treat it as optional before a push. It supersedes the old standalone `test:integration` step: web's `test:coverage` runs the `unit` **and** `integration` projects under v8 instrumentation, so `coverage` both enforces the ≥90 gate and exercises the same web integration paths CI covers.
- **`smoke` is NOT part of `validate`** — it is included in `npm run ci`. It runs `smoke:launcher` (`--help` dispatch) plus the prod `smoke:cli` / `smoke:tui` / `smoke:web` / `smoke:web:browser`, and contains **no build commands** — it assumes the cli/tui/launcher bundles already exist (a full `validate` builds them; `smoke:web` builds `clients/web/dist` on demand). CI runs `validate`, then the `coverage` gate (which also covers the web integration project), then `verify:build-gate` (the #1769 build gate — see below), then `smoke` (with Playwright chromium installed just before it, since `smoke:web:browser` needs it). GitHub CI runs this same chain as separate workflow steps, with the Storybook play-function tests last (see below).
- `smoke:launcher` (`scripts/smoke-launcher.mjs`) runs the built launcher with `--help`, `--cli --help`, and `--tui --help`, asserting each exits 0 and prints that mode's usage banner (which also proves the launcher resolved and loaded the right client build). It's the cheap dispatch check before the heavier prod smokes below.
- `smoke:web` (`scripts/smoke-web.mjs`) starts `mcp-inspector --web` (prod, no `--dev`) against the built `clients/web/dist` and asserts `GET /` serves the SPA (HTTP 200) with the injected `__INSPECTOR_API_TOKEN__`. Prod `--web` serves from `clients/web/dist`, which ships in the published package but is absent in a fresh checkout — the runner builds it on demand (`build:client` = `vite build`) on first launch, or exits with an actionable error if that build can't run (see `clients/web/server/ensure-web-build.ts` and the launcher README). `--dev` runs Vite directly and never needs `dist`. It shares the spawn/readiness/teardown helper (`scripts/lib/prod-web-server.mjs`) with `smoke:web:browser`, so the two can't drift.
- `smoke:web:browser` (`scripts/smoke-web-browser.mjs`, #1615) goes a step further than `smoke:web`: it boots the same prod `--web` server and then actually **runs** the bundle in headless Chromium (Playwright — already a `clients/web` devDependency for the Storybook tests), asserting the app renders its first meaningful frame (the "Add Servers" control) with **no uncaught error**. `smoke:web` only checks the served HTML, so a Node built-in reaching the browser bundle slipped through it; this smoke catches that regression as a *class* (e.g. #1612). The mechanism is the uncaught error, not a magic string: under Vite the excluded module becomes an empty stub and the first *call* into it (e.g. `fs.readFileSync(...)` during a transitive module's init) throws a `TypeError` that aborts app mount. A *synchronous* such throw fires `pageerror`; its *async* twin (the same `TypeError` via `await`/`.then()`, or a failed dynamic import) is logged on the console channel as `Uncaught (in promise) …` / `Failed to fetch dynamically imported module` — the smoke hard-fails on both. The literal `Module "…" has been externalized` text is, **in a prod build**, a build-time warning (`vite build` / `npm run build`), not a runtime message, so the browser never sees it (under `npm run dev` Vite's stub is instead a `Proxy` that `console.warn`s that string at runtime); and an externalized import that is never *called* ships a harmless `{}` and is invisible here by design. Every *other* console error is printed as a diagnostic, not a failure (so a benign font-CDN or React-warning `console.error` doesn't flake CI). Playwright is resolved via `createRequire` based at `clients/web/package.json` — a bare `import("playwright")` would resolve relative to `scripts/`, not the cwd, so it can't be reached that way (it only appears to work when an ancestor `node_modules` carries playwright, and fails in CI, which has none). The npm script's `cd clients/web` exists only so `npx playwright install chromium` finds the local playwright bin (a no-op when already installed).
- **The build gate for the browser-externalized-builtin class (#1769)** is the earlier, more complete companion to `smoke:web:browser`. A Vite plugin in `clients/web/vite.config.ts` (logic in `clients/web/server/browser-externalized-builtin-gate.ts`, unit-tested) turns Vite 8's *browser-externalization warning* (`Module "node:*" has been externalized for browser compatibility`) into a hard `vite build` error, so a Node built-in in the browser graph now **fails `npm run build` / `validate`** instead of shipping a `{}` stub. This catches **both** the *called-at-init* case (which `smoke:web:browser` also catches, but later/at runtime) **and** the *imported-but-never-called* case (the `{}` stub that is invisible to the runtime smoke "by design" — see above). Because rolldown **swallows a throw inside `onLog`** (the one hook where a thrown error doesn't abort — verified against vite@8.0.0), the plugin *records* the warning in `onLog` and re-throws in `buildEnd`. There is **no stable log `code`**, so the gate keys off the documented message phrasing; `npm run verify:build-gate` (`scripts/verify-build-gate.mjs`, in `npm run ci` and the GitHub workflow) runs a real build with a `node:fs` probe forced into `src/main.tsx` and asserts the build fails via the gate — the only check that catches the message phrasing **drifting** in a future Vite bump and silently disabling the gate. The gate is scoped to `vite build` (`apply: 'build'`) — never `vite dev` or the vitest projects — **and** to the browser (`client`) environment (`applyToEnvironment`), so a future SSR/node environment built from this config isn't failed for a legitimate `node:*` import; the Node runner build (tsup, `build:runner`) is a separate config where built-ins are legitimate. `smoke:web:browser` stays as the runtime backstop for crashes the build can't reason about.
- `smoke:cli` (`scripts/smoke-cli.mjs`) drives `mcp-inspector --cli` through the built launcher against the bundled stdio test server via a temp `--catalog`: it asserts `tools/list` returns the server's tools (real connect over stdio), the default writable catalog is seeded empty on first run, a missing read-only `--config` errors without seeding, and `--catalog` + `--config` is rejected. `smoke:tui` (`scripts/smoke-tui.mjs`) launches `mcp-inspector --tui --catalog <temp>` and asserts the Ink app renders its first frame (the "MCP Servers" panel) within a timeout, then SIGTERMs it — a shallow boot/render check, not full interaction. **`smoke:tui` is local-only: it self-skips when `process.env.CI` is set**, because the Ink TUI needs a real TTY (raw mode) that headless CI lacks — so run it (via `npm run smoke`) on your own machine before pushing. Both build `test-servers/build` on demand if it's missing.
- Storybook play-function tests (`clients/web` `test:storybook`) run in headless Chromium via `@vitest/browser-playwright` (~10s). They are part of `npm run ci` (which installs Playwright chromium first); kept out of `validate` because they need the browser binary and are slower than the unit suite.

### Typescript instructions
- Use TypeScript for all new code
- Follow TypeScript best practices and coding standards
- NEVER use 'any' as a type
- NEVER suppress error types (e.g., no-unused-vars, no-explicit-any) in the typescript or eslint configuration as a way of satisfying the linter or compiler.
- AVOID double casts (`as unknown as T`). They erase all type safety and usually signal that the real type is being worked around. Prefer a type guard, a narrower single `as` cast, or fixing the underlying type. When a double cast is genuinely unavoidable (e.g. a documented gap in a third-party type, or bridging a structurally-identical shape TS can't relate), it MUST carry an inline comment justifying why it is safe and why no better option exists — an unjustified `as unknown as` is not acceptable in review.
- Utilize type annotations and interfaces to improve code clarity and maintainability
- Leverage TypeScript's type inference and static analysis features for better code quality and refactoring
- Use type guards and type assertions to handle potential type mismatches and ensure type safety
- Take advantage of TypeScript's advanced features like generics, type aliases, and conditional types to write more expressive and reusable code
- Regularly review and refactor TypeScript code to ensure it remains well-structured and adheres to evolving best practices

## Web source layout: `src/lib` vs `src/utils`

The web client keeps two grab-bag directories under `clients/web/src`, split by a real (now codified) rule — **`utils` = functions that compute; `lib` = things that instantiate, adapt, or touch the environment.** If it does I/O or wraps a subsystem, it's `lib`; if it's a pure transform, it's `utils`.

- **`src/utils/`** — pure, side-effect-free functions. Input → output, no DOM/browser/storage I/O, no subsystem ownership. Trivially unit-testable with no mocks. (Anchors: `jsonUtils`, `schemaUtils`, `toolUtils`, `maskSecrets`, `inspectorTabs`, `deepLink`, `mcpNetworkHeaders`.) Carve-outs that are still `utils`:
  - _Domain types._ Pure **shared domain types plus their pure constructors/transforms** live here (`customHeaders` — `CustomHeader` + `headersToRecord`/`migrateFromLegacyAuth`, a shape staged for `ServerSettingsForm`, see `specification/v2_ux_interfaces_plan.md`, so it currently has no importer but its own test). There is no `types/` sub-bucket **inside** `lib`/`utils` — removing `lib/types/` is what the `customHeaders` move settles.
  - _Diagnostic logging._ `console.warn`/`console.error` does **not** count as a side effect for this rule — a validator that warns on bad input is still "pure" here (`sandbox-csp`, `jsonUtils`, `schemaUtils` all warn).
  - _Importing from `@inspector/core`._ Two forms are fine: a **type-only** import is not a subsystem dependency (`pendingReauth` is pure type declarations), and **re-exporting pure functions or constants** from core is not subsystem ownership either (`oauthUx`/`oauthFlow` re-export core copy/predicates). What makes a module `lib` is wrapping core's *stateful runtime*, not merely importing from it.
- **`src/lib/`** — infrastructure / integration / stateful adapters. Modules that instantiate or compose subsystems, wrap the `@inspector/core` **runtime** (not just its types), touch the DOM / `window` / `sessionStorage`, or otherwise produce side effects. (Anchors: `environmentFactory` composes `InspectorClientEnvironment`; `remoteOAuthStorage` is an adapter class over `core/auth`; `oauthResume` reads/writes `sessionStorage`; `browserTabVisibility` registers `visibilitychange` listeners; `clearServerOAuthState` drives the live `InspectorClient` / `OAuthStorage`; `downloadFile` triggers browser downloads.)

The top-level **`src/types/`** is a sibling of both and is not the place for new domain types — it's now purely the home for ambient `.d.ts` module stubs (e.g. the `react-syntax-highlighter` shims wired through `tsconfig.app.json` `paths`). The last plain-`.ts` domain type there, the dead `navigation.ts` `InspectorTab`, was removed in #1785, so a pure domain type belongs in `utils/`, not `src/types/`.

Cross-directory imports point **one way, `lib → utils`** (infra depends on pure helpers, never the reverse). Keep it that way: if a `utils/` module needs a type currently exported from a `lib/` module, declare the type in `utils/` and re-export it from `lib/` (as `pendingReauth` owns `OAuthResumeAuthKind` and `oauthResume` re-exports it), rather than importing "up" from `utils` into `lib`.

Nothing **enforces** the boundary: no path alias keys off it, and the coverage `include` in `clients/web/vite.config.ts` lists **both** `src/lib/**` and `src/utils/**`, so a move between them is coverage-neutral (this is why the refactor was gate-safe). It's a human-legible signal at import time, valuable in a codebase this test-heavy (the ≥90% per-file gate). Note that `include` is a **whitelist** — it names `components`/`hooks`/`theme`/`lib`/`utils`/`server` (plus the `core/*` runtime; `hooks` and `theme` were added in #1787), so a module placed **outside** those directories (`types/`, `App.tsx`, or a brand-new grab-bag) falls out of the ≥90 gate entirely, silently. The **deliberate, documented** top-level-file exceptions are `src/App.tsx` — a ~4.5k-line composition root at ~42% branch coverage (gating it is a dedicated testing/decomposition effort, not a whitelist tweak) — and the `src/main.tsx` / `src/index.ts` bootstraps (browser `createRoot` render and the bin `runWeb` re-export, the analog of `clients/cli`'s excluded `src/index.ts`). All three are called out in a comment on the `include` array itself rather than left silent. When adding a module, place it by the rule and keep it inside a gated directory; when it genuinely mixes both (e.g. `downloadFile` bundles DOM-side-effect helpers with a couple of pure ones), keep it whole on its dominant side (`lib`) rather than splitting hairs.

## React instructions
- UI Components
  - We are using the Mantine component library for UI.
  - Instructions are at https://mantine.dev/llms.txt
  - Avoid using div and other basic HTML elements for layout purposes.
  - Prefer Mantine's Box, Group, and Stack components for layout.
  - Use Mantine's theme and styling utilities to ensure a consistent and responsive design.
  - NEVER use inline styles on a component.
  - NEVER use raw hex values (`#ddd`, `#94a3b8`, etc.) or `rgba()` literals for colors in component props or theme files. Use `--inspector-*` CSS custom properties defined in `App.css :root` (e.g., `c: 'var(--inspector-text-primary)'`). If no existing token fits, add one to `:root` first.
  - NEVER add a CSS class to a Mantine component when the styles can instead be expressed as component props or a theme variant. CSS classes are a last resort.
  - PREFER component props (via `.withProps()`) to CSS for behavioral and visual styles.
  - PREFER defining styles as theme variants (via `Component.extend()` in `src/theme/<Component>.ts`) over CSS classes. Each Mantine component with custom variants has its own file in `src/theme/`, exporting a `Theme<Name>` constant. The barrel `src/theme/index.ts` re-exports them all and `theme.ts` imports from the barrel. Flat CSS properties (margin, padding, background, border, color, font-size, etc.) belong in the theme. Only pseudo-selectors, nested child selectors, keyframes, and native HTML element styles belong in App.css.
  - App.css must contain ONLY styles that cannot be expressed in the Mantine theme: `@keyframes`, pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships, nested child-element selectors for third-party HTML output (e.g. ReactMarkdown), and styles for native HTML elements (`img`, `iframe`). When refactoring a component, actively move any flat CSS properties out of App.css and into theme variants or `.withProps()` constants.
  - NEVER use inline code; instead extract to functions in the same file, exported or located in a shared location if immediately reusable.
  - In a component's file, for sub-components:
    - ALWAYS use Mantine components for layout and content, configured with props for styling and behavior.
    - ALWAYS declare a meaningfully named subcomponent as a constant using `.withProps()` if an inline Mantine element carries two or more **static** props. A *static* prop is one whose value is a literal that configures the element's **styling, layout, or behavior** (`size="sm"`, `c="dimmed"`, `fw={500}`, `gap="xs"`, `justify="space-between"`, `variant="light"`, `withBorder`, `readOnly`, `striped`, …); dynamic props (`value`, `onChange`/`on*`, `children`, `key`, `ref`, and anything whose value is a variable/expression) do **not** count toward the two and are passed at the call site, not baked into the constant. Purely per-instance **content/accessibility** literals — `label`, `description`, `placeholder`, `title`, `aria-label`, `role` — likewise do **not** count toward the two (a `<Checkbox label="…" description="…">` with no styling/layout/behavior props stays inline); they may be baked into a constant when it already qualifies and doing so aids reuse, but they never by themselves trigger extraction. This rule applies in **all** cases: "repeated pattern" is NOT the bar — a single-use element with two or more static styling/layout/behavior props must still be extracted. Bake the static props into the `.withProps()` constant and pass the dynamic ones where it's rendered.
    - The following **cannot** be expressed via `.withProps()` and so stay inline (like `Box` below), each with a one-line comment saying why: **`Accordion`** (a compound, `multiple`-discriminated generic — `.withProps({ multiple: true, … })` loses its JSX call signature and fails to type); **headless, non-`factory()` Mantine components** such as **`Transition`** (plain function components with no Styles API — they have no `.withProps` static at all, e.g. `Transition.withProps` is a TS2339); and **`data-*` attributes** (not part of a component's typed props object, so excess-property-checked out of a `withProps` literal — pass them at the call site). The rule targets factory-based (Styles-API) Mantine components; anything that isn't one is out of scope entirely — a third-party element (a `react-icons` glyph, another library's component) **and** a first-party component that isn't a Mantine factory (a dumb `export function` like `ContentViewer`, which has no `.withProps` static of its own).
    - NEVER use `Box` for subcomponent constants — `Box` does not support `.withProps()`. Use `Group`, `Stack`, `Flex`, `Text`, `Paper`, `UnstyledButton`, or `Image` instead. Pick the component that best matches the purpose: `Paper` for bordered/surfaced containers, `Text` for any text or content wrapper, `Stack`/`Group`/`Flex` for layout. A `Box` that genuinely needs a non-flex primitive it can't provide — `component="iframe"`, or `display="grid"` (no Mantine flex primitive is a CSS grid) — stays a `Box` inline, with a one-line comment saying why.
    - NEVER use a CSS class on a subcomponent constant when the styles can be expressed as a Mantine theme variant instead. Define variants in `src/theme/<Component>.ts` using `Component.extend({ styles: (_theme, props) => { ... } })` and reference them with `variant="variantName"` on the component or in `.withProps()`.
    - CSS classes are ONLY acceptable on subcomponents for styles that cannot be expressed as flat CSS-in-JS properties in the theme — specifically: pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships (`.parent:hover .child`), nested child-element selectors (`.wrapper p`, `.wrapper code`), `@keyframes` definitions, and native HTML elements (`img`, `iframe`) that are not Mantine components.
    - When a theme variant needs a CSS class for nested/pseudo selectors, use `classNames` in the theme extension to auto-assign it — never add `className` manually in JSX for theme-styled components.
    - Example — subcomponent constant with `withProps`:
    ```tsx
      const CardContent = Group.withProps({
        flex: 1,
        align: 'flex-start',
        justify: 'space-between',
        wrap: 'nowrap',
      });
      return <CardContent> ... </CardContent>
    ```
    - Example — theme variant with auto-assigned className for nested selectors:
    ```tsx
      // src/theme/Paper.ts
      export const ThemePaper = Paper.extend({
        classNames: (_theme, props) => {
          if (props.variant === 'message') return { root: 'message' };
          return {};
        },
        styles: (_theme, props) => {
          if (props.variant === 'message') {
            return { root: { padding: '1.5rem', borderRadius: 12 } };
          }
          return { root: {} };
        },
      }),

      // Component.tsx
      const MessageContainer = Paper.withProps({ variant: 'message' });
    ```
- Theme files vs. Storybook element components
  - **Theme files** (`src/theme/<Component>.ts`) and **element components** (`src/components/elements/`) serve different purposes and both are needed.
  - Theme files customize every instance of a Mantine component app-wide — defaults (size, radius), custom variants, and global style overrides. They are applied automatically by `MantineProvider`.
  - Element components add domain-specific semantics on top of Mantine primitives. For example, `AnnotationBadge` maps domain concepts (audience, destructive, longRun) to Mantine's styling primitives (color, variant). Storybook documents these domain components for designers and developers.
  - Element components MUST import from `@mantine/core`, NOT from `src/theme/`. The theme layer is applied transparently by the provider — elements do not need to know about `Theme<Name>` constants.
  - NEVER push domain-specific variant logic (e.g., annotation types, transport types) into theme files. Domain variants belong in the element component that owns those semantics. Theme files are for styling that applies to the Mantine primitive globally.

## Web backend auth token

The dev/prod web backend protects every `/api/*` route with `x-mcp-remote-auth: Bearer <MCP_INSPECTOR_API_TOKEN>`. The browser recovers that token from three sources, in priority order (see `App.tsx` `getAuthToken()`):

1. `window.__INSPECTOR_API_TOKEN__` — injected into `index.html` on every page load by the backend (the dev Vite plugin via `transformIndexHtml`, the prod Hono server on the `/` route), both routed through `clients/web/server/inject-auth-token.ts`. This is what makes a bare-URL reload, a bookmark, or a cleared `sessionStorage` keep working.
2. `?MCP_INSPECTOR_API_TOKEN=…` query string — the URL the launcher banner prints; kept as a fallback for pasted full URLs.
3. `sessionStorage` — backstop for navigations that land without either of the above.

Injection is a no-op when auth is disabled (`DANGEROUSLY_OMIT_AUTH`), and the global name is the shared `INSPECTOR_API_TOKEN_GLOBAL` constant in `core/mcp/remote/constants.ts`.

