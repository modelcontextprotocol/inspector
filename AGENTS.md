# Inspector V2

This is an application for inspecting MCP servers. It has three incarnations —
Web, TUI, and CLI — over a shared `core/`.

**This file holds the _rules_: the conventions a reviewer cites against a diff.**
It is loaded in full on every turn, so it stays resident and must stay complete
enough to work from on its own.

**The repo's _procedures_ — multi-step recipes with commands and live IDs — live
in [`.claude/skills/`](./.claude/skills).** They are ordinary committed Markdown,
so any agent or human can read one directly; Claude Code loads them on demand and
users invoke them by name.

## Skills index

| Skill | Covers | How it loads |
| --- | --- | --- |
| [`local-dev`](.claude/skills/local-dev/SKILL.md) | Install and run each client; the `@inspector/core` alias; and the **reasoning** behind Dependency placement below — what each rule defends against and how to tell you have hit one (the rules themselves stay here) | Model-invoked, or `/local-dev` |
| [`project-structure`](.claude/skills/project-structure/SKILL.md) | Which client owns which surface, what is in `core/`, where a new file belongs | Model-invoked only |
| [`testing`](.claude/skills/testing/SKILL.md) | Where a test file goes, which command runs it, the tiers, clearing the coverage gate, `renderWithMantine` | Model-invoked, or `/testing` |
| [`issue-create`](.claude/skills/issue-create/SKILL.md) | The five-step create flow: version label, type label, milestone, board card, Status + Priority | Model-invoked, or `/issue-create` |
| [`issue-triage`](.claude/skills/issue-triage/SKILL.md) | The two-pass sweep of unboarded issues, the priority rubric and its score comment, the board audit | Model-invoked, or `/issue-triage` |
| [`board-ops`](.claude/skills/board-ops/SKILL.md) | `gh project` recipes and the field/option IDs for boards #28 and #11; the option-deletion hazard and its recovery | Model-invoked, or `/board-ops` |
| [`pr-flow`](.claude/skills/pr-flow/SKILL.md) | Branch naming, DCO signoff, screenshots, opening the PR, requesting a Copilot review, responding, closing out | Model-invoked, or `/pr-flow` |
| [`pre-push-gate`](.claude/skills/pre-push-gate/SKILL.md) | Running `npm run local:gate` and diagnosing a failing stage | Model-invoked, or `/pre-push-gate` |
| [`release`](.claude/skills/release/SKILL.md) | Cutting a release: bump on `v2/main`, milestone merge, tag `origin/main`, publish | `/release` |
| [`test-servers`](.claude/skills/test-servers/SKILL.md) | Picking and running a showcase test server; the stale-build hazard | Model-invoked, or `/test-servers` |

Longer-form human documentation lives in [`docs/`](./docs) — see the table in the
[README](./README.md#documentation).

## Project Structure

```
inspector/
├── clients/
│   ├── web/          Vite + React + Mantine SPA with a Node backend
│   │   ├── src/         Browser app: components, hooks, lib/, utils/, theme/
│   │   ├── server/      Node-only dev/prod backend wiring
│   │   └── static/      sandbox_proxy.html — served for the MCP Apps tab
│   ├── cli/          Scriptable CLI (tsup bundle, @inspector/core alias)
│   ├── tui/          Ink + React terminal UI (tsup bundle)
│   └── launcher/     The `mcp-inspector` bin; dispatches to web/cli/tui in-process
├── core/             Shared code, consumed via the `@inspector/core` alias (no package.json)
│   ├── auth/         OAuth end to end + the per-server SecretStore backends
│   ├── client/       Install-level client config (`client.json`)
│   ├── json/         JSON/schema utilities shared by all three form builders
│   ├── logging/      Silent pino logger singleton
│   ├── mcp/          InspectorClient, transports, state stores, config import
│   ├── node/         Node-only helpers (version reader, host normalization)
│   ├── react/        React hooks over the state stores (read during render — see React instructions)
│   └── storage/      File I/O helpers for the OAuth persist backends
├── test-servers/     Composable MCP test servers + JSON configs
├── scripts/          Root build/verify tooling (install cascade, smokes, verify:* guards)
│                     plus repo automation run from CI (the dependency + alert sweeps)
├── docs/             Task-oriented guides
├── specification/    Design/build specifications
└── .claude/skills/   The procedures (see the index above)
```

**Every file here carries a header comment explaining its own purpose and the
reasoning behind it.** Read the source rather than looking for a second copy of
that reasoning in this file — a duplicated rationale is one that goes stale
silently. For the fuller map (what each `core/` area owns, what each
`clients/web/server/` file does, where a new file belongs), the
`project-structure` skill.
## Development setup

v2 is **not** an npm workspace — each client under `clients/*` keeps its own
`package.json` and `node_modules`. A single `npm install` at the **repo root**
is still all you need: the root `postinstall` cascades into every client. Node
`>=22.19.0`.

```sh
npm install                      # repo root
npm run build                    # web → cli → tui → launcher
cd clients/web && npm run dev    # day-to-day web iteration (Vite, HMR)
```

Fuller detail — the launcher-driven scripts, the `@inspector/core` alias, and the
worktree trap — is the `local-dev` skill.

## Dependency placement

The reasoning behind each of these, and what breaks when it is ignored, is the
`local-dev` skill. The rules themselves:

- **Every runtime dependency `core/` imports is declared in the repo-root `package.json` and nowhere else.** That is the MCP SDK packages (`@modelcontextprotocol/client`, `core`, `server`, `server-legacy`, `ext-apps`) and, since #2195, the rest of what `core/` reaches: `ajv`, `atomically`, `chokidar`, `hono`, `@napi-rs/keyring`, `pino`, `proper-lockfile`, `react`, `undici`, `zod`. So is anything reached only through root-owned code with no manifest of its own (`test-servers/src`, `core/`). The v1 SDK (`@modelcontextprotocol/sdk`) is **not** a dependency of this repo and must not become one.
- **A root declaration is not by itself a claim that `core/` imports it.** `commander`, `open`, `@hono/node-server`, `vite` and `@vitejs/plugin-react` are root `dependencies` reached only from *client* code, for the runtime-consumption reason below: a published install resolves every externalized import from the root manifest, so a client's runtime import has to be declared there whether or not `core/` also reaches it. Those need naming only in the `external` list of the client that actually imports them, not in all three.
- **A client declares only what that client alone consumes** — its own UI stack, its bundler-inlined packages, its dev tooling. `clients/cli` and `clients/launcher` therefore declare **no** runtime dependencies at all, and that is the expected steady state, not an omission: everything they run on is root-declared and resolves by walk-up from the client directory. Re-adding a root-declared package to a client manifest re-creates the second copy this rule exists to make impossible (#1896), so a missing module at runtime is a signal to check the **root** manifest and the client's `external` list, never to add it back.
- **A package that moves to the root moves its `vitest.shared.mts` pin with it.** Left pointing at `<client>/node_modules` a pin resolves to a directory that no longer exists — or, where a transitive copy happens to sit there (`chokidar` under `vite`, `react` as a peer of `react-dom` and `ink`), to the very duplicate the pin list exists to prevent. **`react` and `react-dom` are the deliberate exception** and stay pinned per client, so a client's renderer and the React it calls into come from one install; every other root-owned pin resolves from the repo root.
- **`dependencies` vs `devDependencies` follows from who consumes it at runtime**, not from where it is declared. Anything `core/` imports at runtime must be a root **`dependency`** — the client builds externalize npm packages and a published install resolves them from the root manifest, where devDependencies are absent.
- **The shared toolchain is declared once, at the repo root, and in no client manifest.** `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `prettier`, `typescript`, `vitest`, `@vitest/coverage-v8` and `@types/node` are used by every client's own scripts, and a client that declares none of them still resolves the root copy by walk-up — `npm run` puts each ancestor `node_modules/.bin` on `PATH`, and Node and TypeScript walk parent `node_modules` / `node_modules/@types` the same way. `clients/launcher` declares no `devDependencies` at all and its `validate` is unchanged. A client-side declaration buys nothing and installs a second copy free to drift, as `globals` (`^17.7.0` root / `^17.4.0` clients) and `typescript-eslint` (`^8.65.0` / `^8.56.1`) had before #2196. These stay **`devDependencies`** — none is consumed at runtime and the tarball ships only each client's `build/`. The boundary is **used by every client**, not "used by one": anything narrower stays where it is, whether one client declares it (`tsx`, `playwright`, `storybook`, `happy-dom`, `ink-testing-library`, `vite-node`, each client's own `@types/*`) or several do — `tsup` is declared in web, cli and tui, and `vite` in web and tui on top of the root **runtime** `dependency` that `--web --dev` needs. Those are out of scope here; consolidating them is a different call with a different rationale.
  - ⚠️ **Deleting the declaration does not always delete the copy, and the local copy still wins.** npm auto-installs an unmet **peer** into the install that needs it, and it has no visibility into the root's tree — so a client-only ESLint plugin drags a client-local `eslint` in (`eslint-plugin-react-refresh`/`-storybook` in web, `eslint-plugin-react-hooks` in tui), and web's Storybook/Vitest stack drags in a local `typescript` and `vitest`. A hoisted transitive does the same: `@types/express` puts an `@types/node` in web and cli. Those copies sit *nearer* than the root's and take precedence. The consolidation is therefore about **one declaration and one place to bump**, not about a single copy on disk. ⚠️ **Nothing keeps the surviving copies aligned, and nothing gates them.** A **peer** copy is at least constrained by its holder's peer range — tightly for `vitest` (an exact peer, hence the pin below), loosely for `eslint` (`^9 || ^10`), where the copies agree only because npm resolves the same latest in both installs. A **transitive** copy is constrained by nothing of ours at all, and cli's `@types/node` (`24.13.1` against the root's `24.13.3`) has already diverged on exactly that. `verify:dep-lockstep` does not catch either: it compares only packages that one `tsc` **program** loads from two installs, so a stray `eslint`, `prettier` or `vitest` binary is outside its candidate set entirely, and the cli `@types/node` difference goes unreported because no one program sees both copies. Check a tool copy by hand — `npm exec -- which eslint` from the client — when you change what a client declares.
  - ⚠️ **`vitest`, `@vitest/coverage-v8` and web's `@vitest/browser-playwright` are pinned exactly, and move together.** `@vitest/browser-playwright` declares an **exact** peer on `vitest`, so it — not the root range — decides which `vitest` web installs. Left to float, the root resolves a newer patch and web's tests then run on one `vitest` while loading a coverage provider built against another. Bumping means editing all three in one change, the same discipline the exact `prettier` pin (#1790) exists for.
- **A root-declared package that `core/` imports at runtime must also be named in all three bundler `external` lists** (`clients/{cli,tui}/tsup.config.ts`, `clients/web/tsup.runner.config.ts`), since which client reaches it is a function of what `core/` imports rather than of what the client's own code names. `npm run verify:bundle-externals` enforces this against the **built output**.
- **A dependency that renders React components must be bundled** into the client that uses it (`noExternal`) and declared only there — an externalized one resolves its own `react` and splits the tree. `ink` is the single exemption, on cost, and it is only safe while the root `react` range stays open to the whole major (`^19.0.0`).
- **One version per install-crossing dependency.** When bumping a dependency the shared sources pull in, bump it in every install that declares it. Consolidating to the root is what makes most of these unbumpable in two places at once, but it does not retire the rule — a client's `devDependencies`, and any package that arrives transitively into a client install, can still skew against the root. Never raise the tsc heap to work around one. `npm run verify:dep-lockstep` enforces this.
- **Pin a transitive dependency with an `overrides` entry**, not with `npm audit fix` — which "resolves" an advisory with no upward escape by silently downgrading.

### Dependency updates are issue-driven, like everything else

**Dependabot opens no pull requests against this repo — neither version updates nor security updates.** A Dependabot PR carries no `Closes #N` and no board card, so it was the one standing exception to [Issue-driven Work Style](#issue-driven-work-style), enforced by nothing. Both halves are now replaced by scheduled workflows that file **issues**, and a maintainer writes the fix by hand against `v2/main`.

| Half | Switched off by | Replaced by | Cadence |
| --- | --- | --- | --- |
| Version updates | Deleting `.github/dependabot.yml` outright (#2235) — an empty `updates:` list is not valid config | `.github/workflows/dependency-refresh.yml` → `scripts/dependency-refresh.mjs`: `npm outdated` across every install, plus a `uses:` check against each action's latest release, folded into **one** tracking issue | Monthly |
| Security updates | `DELETE /repos/{owner}/{repo}/automated-security-fixes` — a **repo setting**, not a file | `.github/workflows/dependabot-alerts.yml` → `scripts/dependabot-alerts.mjs`: reads the alerts and files one issue **per bump** | Daily |

Four things about this that are not obvious from the code:

- **Dependabot *alerts* stay on.** Alerts and security-update PRs are independent settings; only the PRs are off. Turning alerts off would blind the sweep that replaced them.
- **The security half is a schedule, not an event handler**, because there is no `dependabot_alert` workflow trigger — it is a webhook event only.
- **Alerts are computed from the default branch (`main`), and we ship from `v2/main`.** So the sweep re-checks each alert's vulnerable range against `v2/main`'s own lockfile before filing, and skips one that is already fixed there. The converse is a real blind spot with no fix on this path: a vulnerable dependency introduced on `v2/main` and not yet merged to `main` produces **no alert at all**. The release-time `npm audit --audit-level=high` report (#2231) is the partial second signal — and only at release time.
- **`automated-security-fixes` can be re-enabled from the UI without a commit**, so nothing in the repo would record it. The sweep reads it back and **fails loudly on an explicit `enabled: true`**. ⚠️ It is a *conditional* guard, not an invariant: the endpoint needs `administration: read`, which `GITHUB_TOKEN` cannot be granted (`permissions:` has no such key), so under the default token the sweep logs **UNVERIFIED** and carries on rather than going red every day for an unrelated reason. Only a token carrying that scope makes it a real assertion.

An issue filed by either sweep is an ordinary board item — `v2` + `chore` + `dependabot`, the current milestone, and a card on #28. **How it gets its card differs, and the two sweeps are not interchangeable here:**

| | files the card itself? |
| --- | --- |
| Monthly version sweep | **No, never.** It does not attempt a board write at all and has no `PROJECT_TOKEN`; the issue arrives labeled and milestoned, and `/issue-triage` places it. |
| Daily security sweep | **Only when it can.** With an org-project PAT it places the card directly at **Todo / High**; without one it degrades to the same triage hand-off. |

The board write needs `organization projects: write`, which `GITHUB_TOKEN` cannot have — hence "only when it can", and hence a filed-but-unboarded issue is a normal outcome rather than a failure. **Todo, not Incoming**, when the security sweep does place it: arriving through this pipeline *is* the approval. **`High` is a standing override** of the [priority rubric](.claude/skills/issue-triage/SKILL.md), which would otherwise score a routine bump Medium; the issue body records the override so it does not read as a mis-score. ⚠️ A milestone is a precondition for placing a card — `Incoming` ⇔ no milestone — so the security sweep leaves an issue **unboarded** rather than parked at Todo when no dated milestone is open. It picks the open milestone with the nearest **due date**, ignoring undated buckets; the monthly sweep's own selection does not yet filter those out (raised on #2239), so don't read this as a guarantee both scripts already implement.

## Contributing

External contributions are accepted as **issues, not pull requests** — maintainers handle design and implementation through a prompt-driven workflow.
If you've already built a change locally, share the **prompt** you used and screenshots if applicable, not a diff. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full policy.

**This applies to org members with write access too, not just outside contributors.** Having permission to push a branch is not authorization to open a PR. Pull requests against this repo are opened by the **repo maintainers** only. Anyone else — including organization members whose write access makes it technically possible — opens a **detailed issue** instead, and a maintainer takes it from there. A detailed issue means: the problem, how to reproduce it, the behavior you expected, and — if you've already prototyped a fix — the prompt you used and any screenshots, rather than a diff.

**Issues are filed through the forms in [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE) — blank issues are disabled.** GitHub serves the chooser from the **default branch** only, so a form edited here on `v2/main` has no effect on the live chooser until the next milestone merge into `main` — and it cannot be previewed before then, which is why the schema notes below matter. There are two forms, **Bug report** (`1-bug_report.yml`, auto-labels `bug`) and **Feature request** (`2-feature_request.yml`, auto-labels `enhancement` **and `v2`**); `config.yml` holds the chooser's contact links. A form's `labels:` is **static** — GitHub cannot map a reporter's answer to a label — which splits the two cases: the **bug** form could target either line, so it carries a required version-line _dropdown_ and a maintainer applies the matching label at triage per [Label by version](#issue-driven-work-style); the **feature** form is v2 by construction (v1 takes security fixes only and cannot receive a feature), so it needs no dropdown and declares `v2` statically. If v1 ever reopens to features, that static label is what has to change. **There is deliberately no security template**: a vulnerability report must not open a public issue, so the chooser routes it to the private advisory form as a contact link instead (see [`SECURITY.md`](./SECURITY.md)). When adding or changing a form, validate it against GitHub's issue-forms schema (`markdown` blocks take no `id` and no `validations`; `checkboxes` mark `required` per option, not under `validations`).

**Every PR must reference an issue. No exceptions, regardless of who opens it.** The PR body's first line is `Closes #<ISSUE_NUMBER>` (see the [Issue-driven Work Style](#issue-driven-work-style) rules below). A PR with no linked issue has no board card, so the work is invisible to the project board and untracked — if you're about to open one and there's no issue yet, create the issue first. This holds for a maintainer's own one-line fix as much as for a feature.

## Project Status and Direction

Three branches, three distinct roles. Target the one matching the work; **never
open a PR against `main`**.

| Branch | Role | PRs target it? | Publishes to |
| --- | --- | --- | --- |
| `v2/main` | **Develop.** All active v2 work lands here. | **Yes** — every v2 PR | nothing directly; reaches npm via `main` |
| `main` | **Release.** The repo's default branch; holds the latest released v2. Not a development branch. | **No** — it only receives milestone merges from `v2/main` | `latest` |
| `v1/main` | **Maintenance.** The deprecated v1 line, security fixes only, no active development. | **Yes** — every v1 PR, directly | `v1-latest`, published straight from this branch |

So v2 flows `feature branch → v2/main → (milestone) main → npm latest`, while v1
is flat: `feature branch → v1/main → npm v1-latest`, with no merge into `main` at
any point. The two lines publish independently under separate dist-tags, so a v1
fix does **not** need forward-porting.

- **Repo**: https://github.com/modelcontextprotocol/inspector.git
- **Project boards**: v2 → [#28](https://github.com/orgs/modelcontextprotocol/projects/28) (active), v1 → [#11](https://github.com/orgs/modelcontextprotocol/projects/11) (security fixes only)

A corollary for **branching**: cut feature branches from **`v2/main`**, never
from a milestone-merge branch — the latter carries release-only commits that will
show up in your PR's diff. The version bump rides the same flow and is made on
`v2/main`; see the `release` skill.

## Maintenance Rules

### Keep documentation files up to date

- When adding, removing, renaming, or changing the purpose of any file or folder, update the corresponding entry in the main README.md and/or the related clients/*/README.md
- When the structure of the project, the tech stack, or the developer setup changes, update the appropriate README.md files with the details.
- When adding new commands, dependencies, or architectural patterns, update the relevant sections of the appropriate README.md files as well.
- When rules for implementation and testing change, update this file, AGENTS.md.
- **When a _procedure_ changes, update the skill that owns it — not this file.** Rules live here; recipes live in `.claude/skills/`. Two copies of a board ID or a command sequence is strictly worse than one, because the stale copy is indistinguishable from the live one.

### Maintaining the skills

Skills are conditional — a skill's body loads only when it is invoked — so a
skill that stops being reachable loses behavior **silently**. Four rules keep
that from happening:

1. **`npm run verify:skills` must pass.** It runs inside `validate` (and so in
   `local:gate` and in CI). It parses each `SKILL.md`'s frontmatter the way Claude
   Code does and fails on anything that would strip the metadata — most importantly
   **malformed YAML**, which loads the body with an *empty* description, so
   `/skill-name` still works and a manual spot check passes while the skill can
   never auto-fire again. An unquoted colon in a description is enough — and so
   is an unquoted **`#`**, which YAML reads as a comment and which truncates the
   description *silently* from that point on rather than emptying it. `board-ops`
   shipped that way: `Covers board #28 (v2) and board #11 (v1), their
   node/field/option IDs, and the option-deletion hazard` was cut at `#28`, so 90
   characters — including both board numbers — were absent from the listing while
   every check stayed green, because a truncated description is still a non-empty
   one. **Quote any description containing `#` or `:`.** It also
   runs `claude plugin validate` — the authoritative schema — when the installed
   CLI is **exactly** the pinned version, and otherwise says so and moves on.
   That best-effort hand-off keeps `validate` fast and offline, but it also
   means it usually does not run — so the authoritative check gets a **guaranteed
   step of its own**, `npm run verify:skills:cli`, in `local:gate` and in CI.
   It resolves the CLI rather than hoping for one: an installed CLI **only when
   it matches the pin exactly**, otherwise the pinned package via `npx -y`.
   Exact rather than a floor, because a newer local CLI is a *different* schema
   from CI's — accepting it would let the same `local:gate` disagree across
   machines, which is what a pin exists to prevent. Both tiers run the same
   script, so they cannot drift either.
   ⚠️ Frontmatter is only read when the opening `---` is the file's **first
   line** — no BOM, no leading blank line.
2. **Every skill declares its invocation mode explicitly.**
   `disable-model-invocation` is **required** on every skill (`true` = reachable
   only by name, `false` = the model may fire it). A skill that is background
   knowledge rather than an action also sets `user-invocable: false`.
   **Default to `false`.** `true` was the original default here, on the argument
   that a procedure with side effects would be typed as `/name` anyway — but
   *invoking* a skill has no side effects, it loads instructions, and the premise
   is false for anything a user asks for in prose. "Create a PR for #2163" is how
   that work actually starts, and under `true` the model **cannot** reach the
   skill at all: it is absent from the listing and the Skill tool refuses it. The
   costs are asymmetric — a spurious load costs ~250 characters, a missed one
   costs a wrong base branch or an unsigned commit — and the budget is not tight
   (nine of the ten are model-invoked today and total ~3.2k of 4k). Reserve
   `true` for a procedure that is genuinely only ever started deliberately —
   `release` is the only one left, because nobody cuts a release by implication.
   ⚠️ **A `true` skill cannot be reached by another skill either.** If a
   model-invocable skill says "see `/board-ops`", that pointer is a dead end for
   the model unless `board-ops` is model-invocable too.
   ⚠️ **Flipping is not free, and the listing budget is not what costs.** Going
   from three model-invoked skills to nine measurably *lowered* the trigger rate
   of the ones already there: `project-structure` fell from 100% to 0% on two
   cases (n=4) and `testing` from 3/5 to 2/5, while the six new skills all
   measured 100% and every negative case stayed clean. So the ceiling is
   attention, not characters — we were at 2.8k of a 4k budget throughout *that
   experiment* (it is ~3.2k now; the point is that nothing was near the cap). Adding
   a skill therefore has a cost paid by the *existing* ones, which only
   `skills:eval` can see. **Re-run the full eval after any flip _or description
   edit_**, not just the changed skill's own cases.
   **How to write a description that fires, and cases that measure it, is
   [`docs/skill-authoring.md`](./docs/skill-authoring.md)** — the case shapes
   that work, the ones that can never pass, and the probe-then-measure loop.
   The lever that works is the description's *shape*. Leading with the actions
   and then enumerating concrete situations ("Use when … ; when … ; when …")
   beats a noun-phrase list of contents: it took `pre-push-gate` from 3/5 to 5/5
   and `testing`'s three cases from 25/50/25% to 100% each (n=4), displacing
   nothing else.
   ⚠️ **`paths` is not a free win.** It looks like the deterministic option, and
   it does gate loading to matching files — but measured against the `testing`
   skill's own eval cases, adding it roughly **halved** the rate at which the same
   skill fired from a conversational prompt (0–50% with `paths`, 33–100%
   without). It also cannot be measured: a prompt-only eval can never exercise a
   path trigger, so shipping `paths` means shipping an untestable claim. Reach
   for it only when the skill is useless outside those files, and say in the PR
   that you accepted that trade.
3. **A model-invoked skill carries committed eval cases** at
   `evals/evals.json` — positives **and negatives**. Seeing a skill fire once tells
   you Claude found it, not that it finds it reliably, and a skill that fires on
   everything is a context regression that nobody notices by hand. `verify:skills`
   requires both kinds — and at least **five** positives, for breadth rather than
   variance: each prompt is scored on its own `passes / RUNS`, so more prompts
   steady nothing, they cover more of the ways someone might reach the skill and
   expose a description that only fires on one narrow phrasing; `npm run skills:eval` actually runs them (it needs the
   `claude` CLI and real model calls, so it is deliberately **not** in the gate —
   run it when adding a skill or editing a model-invoked description).
   Two things learned writing the first set, both of which make a case measure
   the wrong thing: a prompt whose answer is **already in this file** is not a
   trigger case — the model answers correctly without the skill, and the case
   reads as a miss; and a prompt naming a concrete file or mechanism
   ("how does the `@inspector/core` alias resolve?") invites a `Read`, which is
   a *better* answer than a skill. Good cases are "how do I / where does this go"
   questions whose answer is a procedure.
   ⚠️ **The gate cannot catch a description that never matches.** `verify:skills`
   checks that a skill is well-formed and that its cases exist; only
   `skills:eval` observes whether it actually fires, and that cannot be gated —
   it spends metered model calls, its result is a hit rate rather than a verdict,
   and it goes red on a rate limit. So the eval is a tuning tool you run
   deliberately, and a case below threshold is a signal, not a build break.
4. **Re-check the listing budget when adding a skill.** Claude Code loads a
   listing of every skill's name and description into context, truncates it when it
   overflows, and drops the least-invoked entries **first** — which are exactly the
   model-invoked skills that must fire on their own. `verify:skills` prints the
   current cost against the budget recorded in `scripts/lib/skill-manifest.mjs`
   (3,234/4,000 characters as of this writing) and fails when it is exceeded. Raise
   the budget deliberately, or tighten a description; each entry is capped at 1,536
   characters regardless, so **put the key use case first**.

One asymmetry that reinforces the rules-vs-recipes split: once invoked, a skill's
content stays in the conversation — but auto-compaction re-attaches only the most
recent invocation of each, under a combined budget, so in a long session the older
ones can be dropped entirely. `AGENTS.md` does not degrade that way. **If a
convention lived solely in a skill body it could vanish mid-session, in exactly
the long tasks where it matters most** — which is why rules stay here.

⚠️ Skills in nested `.claude/skills/` directories below the working directory do
**not** load at startup. Keep everything in the repo-root `.claude/skills/` and
let `paths` do the scoping.

## Issue-driven Work Style

All work is driven by items on the project board. The *recipes* for the flows
below are in the `issue-create`, `issue-triage`, `board-ops` and `pr-flow`
skills; the rules are here.

- **Before starting work, check the board for the relevant item.**
- **Every board item is a real GitHub issue.** No draft cards. Before creating a new issue, check the board for a matching item — **never create a duplicate**.
- **Only issues go on a board — never PRs.** A PR gets the `v2` label but is tracked through its linked issue's card (via `Closes #N`), not its own board item.
- **Label by version — every issue and every PR, no exceptions.** Exactly one of `v1` (work targeting `v1/main`, the deprecated security-fix-only line) or `v2` (active development; the default for anything new). There is no unlabeled state and no "decide later": an issue with neither label belongs to no version line and is invisible to every version-filtered query. Set it at **create time** (`gh issue create --label v2 …`), never by backfilling. **If the target version isn't obvious, it's `v2`.**
- **Label by type — exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question`** on every issue you create or triage. The version label says which line the work belongs to; the type label says what kind of work it is, and the two are independent. Don't force the binary: pressing a docs task or a dependency pin into `enhancement` degrades it to "not a bug", at which point filtering by it stops telling you anything. A **PR** needs no type label — it is classified through the issue it closes.
- **Every v2 issue you create gets a milestone.** Milestones are *release* buckets, so pick by when the work ships. Never leave a v2 issue you filed unmilestoned pending a decision. Two exceptions, both deliberate: an issue that arrives **unboarded** stays unmilestoned in `Incoming` until a maintainer approves it — there, the *absence* of a milestone is the signal; and **every milestone is a v2 release bucket, so a `v1` issue has none to take**. Say so when filing one rather than dropping it in a v2.x bucket.
- **Every v2 board item has a Priority.** Priority is a **board field**, not a label, so an unboarded issue has nowhere to store it. Derive it with the rubric in the `issue-triage` skill rather than asserting it. Board #11 has no Priority field; a v1 issue gets a Status and nothing else.
- **`Incoming` ⇔ no milestone; everything past it ⇔ milestoned — on board #28.** Board #11 is exempt for the reason above: a v1 issue has no bucket to take, so its Status is set on its own and the audit's milestone checks do not apply to it. The rest of the invariant is unchanged: assigning the milestone *is* the approval act, so the two always go together. `Todo` asserts a maintainer signed off, so never park an unreviewed issue there — that erases the distinction and quietly promotes unreviewed work into the queue. An issue created through the documented flow skips `Incoming` entirely, because filing it *was* the approval.
- **`Done` means the work shipped.** Exactly two things earn a card a place in Done: its **PR merged**, or it is a **parent whose last sub-issue closed**. Anything else — duplicate, won't fix, not planned, obsolete, superseded — means nothing shipped, so the card is **deleted**. Done is read as the record of what a milestone actually delivered; a duplicate sitting there makes that record wrong in a way nobody can detect later. Deleting a card touches the board only — the issue keeps its labels and comments and stays searchable forever.
- **When work begins**, create a feature branch and set Status to **In Progress**. **Branch names start with the target version segment** — `v2/fix/2071-oauth-resource-metadata`, `v1/fix/proxy-ssrf-pin` — matching the base branches themselves.
- **When work is complete**, run `npm run format` then `npm run local:gate`, **sign off every commit** (`git commit -s` — the DCO check is a hard merge gate with no partial credit), open a PR against the matching base branch with **`Closes #<ISSUE_NUMBER>` as the body's first line**, and set Status to **In Review**.
- **Attach screenshots as proof of functionality** for any web-UI or TUI change. Put them in a **`pr-screenshots/`** folder off the repo root — it is **gitignored**, so the images are staged for upload and never committed — and name them for what they show.
- ⚠️ Closing keywords only auto-link and auto-close for PRs targeting the **default branch** (`main`). A v2 PR targets `v2/main`, so `Closes #N` there is only a cross-reference. **On merge, manually close the issue and move the card to Done.** Keep the line anyway, so the issues close if/when `v2/main` reaches `main`.
- **If new tasks are discovered during development, create issues** and add them to the board.

### Responding to Code Reviews

When asked to respond to a code review of a PR:

- it is not necessary to implement all suggestions
- you are free to implement suggestions in a different way, or to ignore one if there is a good reason
- after making the changes, respond to each review comment with what was done (or why it was ignored)
## Always test new or modified code

The *procedure* — where a given test file goes, which command runs it, how to
diagnose a failing gate — is the `testing` skill. These are the rules.

- **Ensure all code has corresponding tests.** New code must clear **≥ 90 on all four dimensions** — lines, statements, functions, and branches — per file. This gate is enforced by each client's `test:coverage` across `clients/web`, `clients/cli`, `clients/tui` and `clients/launcher`, and **CI enforces it**: a PR that drops any file below 90 on any dimension fails.
- **A genuinely-unreachable branch is annotated at the source, never waved through by lowering the gate.** Use a justified `/* v8 ignore … -- <reason> */`. Acceptable reasons: happy-dom-inherent paths (Mantine portal mount points, `useMediaQuery` fallbacks, `typeof window` SSR guards); React StrictMode effect-replay blocks; and provably-dead defensive guards (a `?? fallback` for a value the types guarantee non-null, a `Select.onChange` receiving a value outside the allowed list). Reach for it only when the branch is genuinely impossible to exercise.
- **In unit tests that expect error output, suppress it from the console.**
- **Test placement — side-by-side by default, `src/test/` only for what can't be co-located, and the Node clients are different.**
  - **`clients/web`**: `<Name>.test.tsx` **next to the source** — components, hooks, `lib/`, `utils/`. A web-owned test living under `src/test/` instead is a bug. `src/test/` is for the three things that cannot be co-located: tests of the repo-root **`core/`** package (`src/test/core/…`, mirroring the `core/` layout — it lives outside `clients/web/` and has no harness of its own); the **`integration`** project (`src/test/integration/…` — *placement is the manifest*, picked up by a folder glob, with no enumeration to keep in sync); and **shared test infrastructure** (`renderWithMantine.tsx`, `setup.ts`, `fixtures/`).
  - **`clients/cli`, `clients/tui`, `clients/launcher`**: **all** tests in a top-level **`__tests__/`**, not beside their source. Their `tsconfig.json` excludes `**/*.test.*`, so a co-located test lands in **no** tsconfig project and fails `npm run verify:typecheck-coverage`.
  - **Root tooling**: a `scripts/*.mjs` helper with pure logic gets a sibling `*.test.mjs`. Keep that exact filename — `node --test` silently *skips* a file its glob misses and still exits 0.
- **Render React components through `renderWithMantine`** (`src/test/renderWithMantine.tsx`); do not hand-roll a bare `MantineProvider`, which skips the project theme and the helper's options and drifts from every other test. Pass the `colorScheme` option to exercise a forced scheme rather than hand-rolling `defaultColorScheme`. Use `renderWithMantineTransitions` **only** when a test must assert mid-flight transition state, and read the long comment on the helper before changing anything about it.
- **The web coverage `include` is a whitelist.** It names `components`/`hooks`/`theme`/`lib`/`utils`/`server` plus the browser-consumed `core/*` runtime, so a module placed **outside** those directories falls out of the gate entirely, silently. Place new modules inside a gated directory. The documented exceptions — `src/App.tsx` and the `src/main.tsx` / `src/index.ts` bootstraps — are called out in a comment on the `include` array itself.

## Mandatory pre-push gate

- **ALWAYS run `npm run format` before committing.** The **root** `format` auto-fixes `core/`, the root `scripts/` tooling, the root shared surface, and every client's scope in one shot. `validate` runs the non-fixing `format:check` and will fail in CI on any unformatted file, so run the auto-fixer first rather than letting `format:check` catch it.
- **`npm run local:gate` is the mandatory pre-push command.** It is a **strict superset** of `.github/workflows/main.yml`, so passing it locally means CI's gates will pass. Expect several minutes.
- **`npm run validate` is the fast inner-loop check and is NOT an acceptable substitute.** It runs `test`, not `test:coverage`, so it does **zero** coverage gating, no smokes, and no Storybook tests. Skipping the gate is how a push passes every fast local check and still fails CI.
- There is deliberately **no `npm run ci`** — that name collided with the `npm ci` built-in, which clean-installs from the lockfile and does not run this script.
- What each stage covers, and why two of them are local-only, is [`docs/quality-gate.md`](./docs/quality-gate.md); how to diagnose a failing stage is the `pre-push-gate` skill.

## Build output is never a gate target

**No gate — lint, format, or typecheck — may read generated output.** The gated surface is first-party source only: `clients/*/src`, `clients/*/__tests__`, `clients/web/{server,.storybook}`, each client's top-level configs, `core/`, `test-servers/src`, `scripts/`, and the root shared files. Everything a build writes is out of scope: `clients/*/build` (the tsup/tsc bundles), `clients/web/dist` (the Vite SPA), `clients/web/storybook-static`, `clients/*/coverage`, `test-servers/build`, `core/**/{build,dist}`, and any `*.tsbuildinfo`. Each scope states this itself — `globalIgnores([...])` in every `eslint.config.js`, the `format`/`format:check` globs in each `package.json`, and a tsconfig `include` that names source directories rather than the package root.

Why it matters, given that these paths are all gitignored and the findings are usually warnings:

- **It reports defects nobody can fix.** A bundle vendors third-party code, so a rule that fires inside it names a problem in someone else's source. `clients/web` shipped this for a while: `build` was missing from its `globalIgnores` while its three sibling clients had it, so the client's *only* lint output was an unused-`eslint-disable` warning from inside the vendored `undici` (#2043).
- **A warning becomes a gate failure without warning.** `reportUnusedDisableDirectives` is a warning by default and a rule promotion — or any new rule a bundled dependency happens to trip — turns it into a `validate` failure on a file nobody wrote. #1959 (enabling `no-floating-promises` across all five scopes) is exactly that kind of change.
- **It trains people to skim the channel.** A scope whose lint is never clean has no signal left in it, and the real warning added later lands where everyone has learned to look past.
- **It is wasted work on every run.** `lint` runs inside `validate`, the fast inner-loop check, and the web runner bundle alone is ~1.2MB of generated JS.

The two coverage guards do **not** catch this, and adding a third is not the fix. `verify:format-coverage` and `verify:typecheck-coverage` assert that first-party source is *covered*; neither asserts that generated output is *excluded* — an asymmetry that is deliberate, since a guard can't distinguish "generated" from "source" without being told, and the ignore lists are already that statement. So this class drifts silently and the check is a human one: **when a build starts writing to a new location, add it to that scope's ignore list in the same change.** The reverse of the guards' rule also holds — never widen an ignore to silence a finding in first-party code, and never add a build directory to a tsconfig `include` to make a generated `.d.ts` resolve (import the source, or fix the build's types).

## Lint has no warning tier

**Every `lint` script runs with `--max-warnings 0`, so a warning fails `validate` exactly as an error does (#2085).** All six scopes carry the flag — each of `clients/{web,cli,tui,launcher}`'s `eslint .`, plus the root's `lint:core` and `lint:shared`.

This exists because the gate's promise — that passing `npm run local:gate` locally means CI's gates pass — was kept while a real bug walked through it. `react-hooks/exhaustive-deps` ships at `warn` in the recommended set, and two `useCallback`s in `App.tsx` omitted a non-stable `refresh` from their dependency arrays; ESLint printed the right message on both lines on every run, nothing consumed it, and the stale closure was caught only by a review round on #2076. It is the same argument [Build output is never a gate target](#build-output-is-never-a-gate-target) makes from the other direction: a channel nobody fails on is one people learn to skim.

Two consequences worth stating:

- **Do not silence a finding to satisfy the gate.** A warning is now a defect to fix. If a rule genuinely must be waived on a line, use its inline disable comment **with a one-line justification** — the same standard this document sets for `v8 ignore` and for `void` on a floating promise. Widening a `globalIgnores` or dropping a rule to make `lint` pass is not an acceptable fix.
- **A rule left at `warn` still reads wrong in an editor.** The flag makes severity irrelevant to the *gate*, not to the developer looking at a squiggle. `react-hooks/exhaustive-deps` is therefore set to **`error`** in every React scope (`clients/web`, `clients/tui`, and the root's `core/react/**` block) rather than relying on the CLI flag alone. Prefer `error` for any rule you actually intend to enforce.

## Typescript instructions

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
- **NEVER leave a promise floating.** `@typescript-eslint/no-floating-promises` is enabled at `error` in **all five** ESLint scopes — `clients/{web,cli,tui,launcher}` and the root `core/` + shared gate (#1959). Every promise must be awaited, returned, terminated with `.catch(…)`, or explicitly discarded with the `void` operator.
  - **The class it catches is invisible at review time.** A floated call reads like an awaited one minus four characters, and the unhandled rejection it produces surfaces somewhere else entirely — a different test, a different file, a stack pointing at SDK internals. Two un-held `client.callTool(...)` promises made `npm run local:gate` unpassable in #1947: `disconnect()` rejected them with `Connection closed`, the unhandled rejection failed the whole vitest run, and the chain aborted at `coverage`, silently skipping `verify:build-gate`, `smoke`, and Storybook. Attributing it took a full investigation; the fix was two lines.
  - **Prefer holding and settling the promise.** `void` is an escape hatch, not a fix — it is visible at review time (strictly better than nothing) but still discards the rejection. Reach for it only when the callee already owns its failures (it ends in a `catch` that surfaces the message) or the caller genuinely cannot await — a synchronous `useEffect` body, an Ink `useInput` key handler, a Hono `stream.onAbort` listener. Say **which** of those it is in a one-line comment; an unexplained `void` is a review finding. Where the callee does *not* own its failures, give it a `catch` rather than voiding the call (see `handleDisconnect` in `clients/tui/src/App.tsx`), or terminate with `.catch(…)` at the call site (see `open(url)` in `clients/web/server/{server,vite-hono-plugin}.ts`).
  - **In Storybook play functions, `expect(...)` from `storybook/test` returns a promise.** Storybook instruments it so the interactions panel can trace each assertion, so every `expect` in a play function is awaited — as is any shared helper that wraps one (`src/test/scrollAreaStoryAssertions.ts` is `async` for this reason).
  - **The rule is type-aware, so each scope's ESLint config carries a parser project.** Each client's config must name **every leaf project covering its lint surface**, since the parser needs a program that literally *contains* the file — for cli, tui, and launcher that is the two they already typecheck (`tsconfig.json` + `tsconfig.test.json`, `src` in the first and `__tests__` only in the second), and for **web it is four** (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.storybook.json`, `tsconfig.test.json`) — web's `tsconfig.json` is a solution file with `files: []`, so naming it alone would contain nothing. Adding a leaf project to a client means adding it here too. The root config instead points at **`tsconfig.lint.json`**, which exists solely to give the parser a program covering `core/**`, `test-servers/src/**`, and `vitest.shared.mts` — none of which is rooted in a tsconfig of its own. That file emits nothing and gates nothing: type *checking* for those sources stays where it was (`core/` through `clients/web`'s `tsc -b`, `test-servers/src` through `clients/cli`'s test project). It sets `moduleResolution: bundler` deliberately — `core/` uses extensionless relative imports, which NodeNext fails to resolve, degrading every import to `any` so the rule silently stops seeing promises at all. **Its `include` must stay a superset of the root config's type-aware `files` globs** — a file the lint block matches but the project omits fails outright with "was not found in any of the provided project(s)" rather than being checked, so widening one means widening the other (that is why the `include` carries `test-servers/src/**/*.tsx`, which nothing has produced yet). Note also that a tsconfig `include` does **not** expand braces — `core/**/*.{ts,tsx}` matches nothing; list the extensions separately.
  - Type-aware linting costs real time: `clients/web`'s `eslint .` went from ~8s to ~19s, and `lint` runs inside `validate`, the fast inner-loop check. That is the price of the guarantee; if it needs reducing later, narrowing the projects each scope loads is the lever, not dropping the rule.

## Web source layout: `src/lib` vs `src/utils`

The web client keeps two grab-bag directories under `clients/web/src`, split by a real (now codified) rule — **`utils` = functions that compute; `lib` = things that instantiate, adapt, or touch the environment.** If it does I/O or wraps a subsystem, it's `lib`; if it's a pure transform, it's `utils`.

- **`src/utils/`** — pure, side-effect-free functions. Input → output, no DOM/browser/storage I/O, no subsystem ownership. Trivially unit-testable with no mocks. (Anchors: `jsonUtils`, `schemaUtils`, `toolUtils`, `maskSecrets`, `inspectorTabs`, `deepLink`, `mcpNetworkHeaders`, `errorFormat`, `stepUp`, and the toast-id/formatter modules under `utils/toasts/`.) Carve-outs that are still `utils`:
  - _Domain types._ Pure **shared domain types plus their pure constructors/transforms** live here (`customHeaders` — `CustomHeader` + `headersToRecord`/`migrateFromLegacyAuth`, a shape staged for `ServerSettingsForm`, see `specification/v2_ux_interfaces_plan.md`, so it currently has no importer but its own test). There is no `types/` sub-bucket **inside** `lib`/`utils` — removing `lib/types/` is what the `customHeaders` move settles.
  - _Diagnostic logging._ `console.warn`/`console.error` does **not** count as a side effect for this rule — a validator that warns on bad input is still "pure" here (`sandbox-csp`, `jsonUtils`, `schemaUtils` all warn).
  - _Importing from `@inspector/core`._ Two forms are fine: a **type-only** import is not a subsystem dependency (`pendingReauth` is pure type declarations), and **re-exporting pure functions or constants** from core is not subsystem ownership either (`oauthUx`/`oauthFlow` re-export core copy/predicates). What makes a module `lib` is wrapping core's _stateful runtime_, not merely importing from it.
- **`src/lib/`** — infrastructure / integration / stateful adapters. Modules that instantiate or compose subsystems, wrap the `@inspector/core` **runtime** (not just its types), touch the DOM / `window` / `sessionStorage`, or otherwise produce side effects. (Anchors: `environmentFactory` composes `InspectorClientEnvironment`; `remoteOAuthStorage` is an adapter class over `core/auth`; `oauthResume` reads/writes `sessionStorage`; `browserTabVisibility` registers `visibilitychange` listeners; `clearServerOAuthState` drives the live `InspectorClient` / `OAuthStorage`; `downloadFile` triggers browser downloads; `authToken` reads `window.location` and `sessionStorage`; `protocolReplay` re-issues a request through the live `InspectorClient`.)

The top-level **`src/types/`** is a sibling of both and is not the place for new domain types — it's now purely the home for ambient `.d.ts` module stubs (e.g. the `react-syntax-highlighter` shims wired through `tsconfig.app.json` `paths`). The last plain-`.ts` domain type there, the dead `navigation.ts` `InspectorTab`, was removed in #1785, so a pure domain type belongs in `utils/`, not `src/types/`.

Cross-directory imports point **one way, `lib → utils`** (infra depends on pure helpers, never the reverse). Keep it that way: if a `utils/` module needs a type currently exported from a `lib/` module, declare the type in `utils/` and re-export it from `lib/` (as `pendingReauth` owns `OAuthResumeAuthKind` and `oauthResume` re-exports it), rather than importing "up" from `utils` into `lib`.

Nothing **enforces** the boundary: no path alias keys off it, and the coverage `include` in `clients/web/vite.config.ts` lists **both** `src/lib/**` and `src/utils/**`, so a move between them is coverage-neutral (this is why the refactor was gate-safe). It's a human-legible signal at import time, valuable in a codebase this test-heavy (the ≥90% per-file gate). Note that `include` is a **whitelist** — it names `components`/`hooks`/`theme`/`lib`/`utils`/`server` (plus the `core/*` runtime; `hooks` and `theme` were added in #1787), so a module placed **outside** those directories (`types/`, `App.tsx`, or a brand-new grab-bag) falls out of the ≥90 gate entirely, silently. The **deliberate, documented** top-level-file exceptions are `src/App.tsx` — a ~3.2k-line composition root at ~42% branch coverage (gating it is a dedicated testing/decomposition effort, not a whitelist tweak) — and the `src/main.tsx` / `src/index.ts` bootstraps (browser `createRoot` render and the bin `runWeb` re-export, the analog of `clients/cli`'s excluded `src/index.ts`). All three are called out in a comment on the `include` array itself rather than left silent. When adding a module, place it by the rule and keep it inside a gated directory; when it genuinely mixes both (e.g. `downloadFile` bundles DOM-side-effect helpers with a couple of pure ones), keep it whole on its dominant side (`lib`) rather than splitting hairs.

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
    - ALWAYS declare a meaningfully named subcomponent as a constant using `.withProps()` if an inline Mantine element carries two or more **static** props. A _static_ prop is one whose value is a literal that configures the element's **styling, layout, or behavior** (`size="sm"`, `c="dimmed"`, `fw={500}`, `gap="xs"`, `justify="space-between"`, `variant="light"`, `withBorder`, `readOnly`, `striped`, …); dynamic props (`value`, `onChange`/`on*`, `children`, `key`, `ref`, and anything whose value is a variable/expression) do **not** count toward the two and are passed at the call site, not baked into the constant. Purely per-instance **content/accessibility** literals — `label`, `description`, `placeholder`, `title`, `aria-label`, `role` — likewise do **not** count toward the two (a `<Checkbox label="…" description="…">` with no styling/layout/behavior props stays inline); they may be baked into a constant when it already qualifies and doing so aids reuse, but they never by themselves trigger extraction. This rule applies in **all** cases: "repeated pattern" is NOT the bar — a single-use element with two or more static styling/layout/behavior props must still be extracted. Bake the static props into the `.withProps()` constant and pass the dynamic ones where it's rendered.
    - The following **cannot** be expressed via `.withProps()` and so stay inline (like `Box` below), each with a one-line comment saying why: **`Accordion`** (a compound, `multiple`-discriminated generic — `.withProps({ multiple: true, … })` loses its JSX call signature and fails to type); **headless, non-`factory()` Mantine components** such as **`Transition`** (plain function components with no Styles API — they have no `.withProps` static at all, e.g. `Transition.withProps` is a TS2339); and **`data-*` attributes** (not part of a component's typed props object, so excess-property-checked out of a `withProps` literal — pass them at the call site). The rule targets factory-based (Styles-API) Mantine components; anything that isn't one is out of scope entirely — a third-party element (a `react-icons` glyph, another library's component) **and** a first-party component that isn't a Mantine factory (a dumb `export function` like `ContentViewer`, which has no `.withProps` static of its own).
    - NEVER use `Box` for subcomponent constants — `Box` does not support `.withProps()`. Use `Group`, `Stack`, `Flex`, `Text`, `Paper`, `UnstyledButton`, or `Image` instead. Pick the component that best matches the purpose: `Paper` for bordered/surfaced containers, `Text` for any text or content wrapper, `Stack`/`Group`/`Flex` for layout. A `Box` that genuinely needs a non-flex primitive it can't provide — `component="iframe"`, or `display="grid"` (no Mantine flex primitive is a CSS grid) — stays a `Box` inline, with a one-line comment saying why.
    - NEVER use a CSS class on a subcomponent constant when the styles can be expressed as a Mantine theme variant instead. Define variants in `src/theme/<Component>.ts` using `Component.extend({ styles: (_theme, props) => { ... } })` and reference them with `variant="variantName"` on the component or in `.withProps()`.
    - CSS classes are ONLY acceptable on subcomponents for styles that cannot be expressed as flat CSS-in-JS properties in the theme — specifically: pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships (`.parent:hover .child`), nested child-element selectors (`.wrapper p`, `.wrapper code`), `@keyframes` definitions, and native HTML elements (`img`, `iframe`) that are not Mantine components.
    - When a theme variant needs a CSS class for nested/pseudo selectors, use `classNames` in the theme extension to auto-assign it — never add `className` manually in JSX for theme-styled components.
    - Example — subcomponent constant with `withProps`:
    ```tsx
    const CardContent = Group.withProps({
      flex: 1,
      align: "flex-start",
      justify: "space-between",
      wrap: "nowrap",
    });
    return <CardContent> ... </CardContent>;
    ```
    - Example — theme variant with auto-assigned className for nested selectors:
    ```tsx
    // src/theme/Paper.ts
    export const ThemePaper = Paper.extend({
      classNames: (_theme, props) => {
        if (props.variant === "message") return { root: "message" };
        return {};
      },
      styles: (_theme, props) => {
        if (props.variant === "message") {
          return { root: { padding: "1.5rem", borderRadius: 12 } };
        }
        return { root: {} };
      },
    });

    // Component.tsx
    const MessageContainer = Paper.withProps({ variant: "message" });
    ```
- State and effects
  - **NEVER reset or re-sync local state from a prop inside a `useEffect`.** `useEffect(() => setX(prop), [prop])` renders once with the stale value, paints it, and only then corrects itself — the user sees the wrong frame and React renders twice. It is an error under `react-hooks/set-state-in-effect`, which the `eslint-plugin-react-hooks` recommended set enforces for the web client and — since #2192 — for `core/react/` too. (`clients/tui` registers the plugin but deliberately enables only `rules-of-hooks` and `exhaustive-deps`, for the reason its own config states.)
  - Use **`useValueChange(value, onChange)`** (`clients/web/src/hooks/useValueChange.ts`) instead. It is React's documented ["adjusting state during render"](https://react.dev/reference/react/useState#storing-information-from-previous-renders) pattern: it compares `value` against the previous render's with `Object.is` and calls `onChange(next)` during render, so React discards the in-progress output and re-runs the component before anything reaches the DOM. It does **not** fire on the first render — seed the dependent state with `useState` instead. Because the comparison is `Object.is`, the value you pass **must be referentially stable** across renders that mean "no change": prefer a primitive key derived from the data (an id, a name, a URI), and otherwise a memoized value. A fresh object/array literal would compare unequal every render and loop.
  - The `onChange` you pass runs **during render**, so it must be pure — `setState` calls and nothing else. No fetches, DOM writes, logging, ref mutation, or parent callbacks: a render can be replayed (StrictMode) or abandoned (concurrent React), so external work would run an unpredictable number of times.
  - An effect is still the right tool for genuine synchronization with an external system (DOM measurement, `requestAnimationFrame`, subscriptions, timers). The rule is about deriving React state from React props, not about effects in general. `NetworkEntry` shows the split: the reveal's force-open is a state update and uses `useValueChange`, while its `requestAnimationFrame` scroll stays a `useEffect`.
  - **Subscribing to an `@inspector/core` state store is `useSyncExternalStore`, never `useState` + a subscribing `useEffect`.** That second shape looks like the legitimate "synchronize with an external system" case above and is not, because it also *seeds and re-seeds local state from the store prop* — so it carries the same stale frame (switching servers paints the previous server's tools for one frame) plus a window where an event dispatched between the render and the effect is lost outright. Every hook in `core/react/` was converted away from it in #1955.
    - Reach for **`useStoreSnapshot(store, event, read, whenAbsent)`** (`core/react/useStoreSnapshot.ts`) when the getter returns a **fresh value per read** — a defensive copy (`getTools()` is `[...this.items]`) or a freshly built object (`getPagination()`). That is nearly all of them, and the caching it adds is what keeps `useSyncExternalStore` from looping. Call it once per value.
    - When a getter's value is **already referentially stable**, subscribe with `useSyncExternalStore` directly and skip the helper — `useListError` does, because its snapshot is the stored `Error` instance itself (or `null`). The rule is read-during-render, not "always use the helper".
    - Either way `useValueChange` is *not* the tool here — it lives in `clients/web/src`, and `core/react/` is consumed by the CLI and TUI too.
    - `read` and `whenAbsent` must be **referentially stable across renders** — they are part of the snapshot's cache key. `read` is a function, so declare it at module scope. `whenAbsent` only needs a module-scope constant when it is an **object or array** (`NO_TOOLS`, `NO_PAGINATION`); a primitive fallback (`false`, `undefined`, `"disconnected"`) is already stable under `Object.is` and is passed inline throughout these hooks.
    - An unstable one **fails quietly, so don't expect to be told**: measured on React 19, an inline `read` throws nothing, logs nothing — not even React's "getSnapshot should be cached" dev warning, whose double-call happens within a single render where the closure is unchanged — and forces no extra render. It simply returns a fresh value every render, defeating every downstream `useMemo` / `React.memo` / effect dep that keys on it.
    - The snapshot is cached against the store's **per-event dispatch counter** (`TypedEventTarget.getEventRevision`), which every dispatch advances automatically — not against the snapshot's contents. That is deliberate and load-bearing: these getters return a defensive copy, so contents are the only alternative, and a contents comparison cannot see a dispatch that mutated an entry the list already holds (`MessageLogState` folding a response into its request entry does exactly that). Don't "optimize" it into a shallow compare.
    - Consequently the **store is the source of truth and the event is only the signal** — the hook re-reads the store rather than taking the event's `detail`. A test that fires a store event must put the value on the store first; dispatching alone announces a change that isn't there. A hand-rolled fake must extend the real `TypedEventTarget` (a bare `EventTarget` has no `getEventRevision` and fails at runtime).
    - Genuinely local state accumulated from an event stream, with no getter to read it back from, stays `useState` — `useInspectorClient`'s `lastError` is the one such case. Reset it on a store swap **during render**, not in an effect.
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
