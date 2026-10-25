---
name: release
description: "Cut an Inspector v2 release — two PRs and then a GitHub Release. PR 1 puts the npm audit, any fixes it forces, and the version bump on v2/main; PR 2 merges v2/main into main and is smoke-tested from the production build with a ledger artifact for the maintainers; the maintainer then drafts the Release with a script and publishes it. Also covers the v1 line and what the publish jobs gate on."
disable-model-invocation: true
---

# Cutting a release

Background on what ships and why (the `files` allowlist, the bundling rules, the
container image) is in [`docs/publishing.md`](../../../docs/publishing.md). This
skill is the procedure.

A v2 release is cut from **`main`**, after the milestone's work has been merged
there from `v2/main` — not from `v2/main` itself. The v1 line releases
independently from `v1/main` to the `v1-latest` tag and never touches `main`.

Publishing is automated by release-gated jobs in
`.github/workflows/main.yml` (`github.event_name == 'release'`), all downstream
of `needs: [build, coverage]` — so a release cannot publish with either the build
job or the coverage gate red:

- **`package`** — asserts the release tag matches the root `package.json`
  version, installs, runs `npm run pack:verify` as the pre-publish gate, then
  `npm pack`s the tarball and uploads it as an artifact. It holds **no**
  `id-token`.
- **`publish`** — `needs: [package]`; holds `id-token: write` and only downloads
  that tarball and runs `npm publish <tgz> --access public --provenance`. No
  checkout, no dependency install, no build — the split keeps install scripts
  away from the OIDC publish token (#2483).
- **`publish-github-container-registry`** — the GHCR image.

## The shape: two PRs, then the Release

There is **one version number** (only the root `package.json` has one — the
clients carry none), and the release moves through **two pull requests** in
order. They are not interchangeable and neither one's content belongs on the
other.

| | PR 1 — prep | PR 2 — the milestone merge |
| --- | --- | --- |
| Branch | `v2/chore/<ISSUE>-bump-<X-Y-Z>`, cut from `origin/v2/main` | the milestone-merge branch, cut from `origin/main` |
| Base | **`v2/main`** | **`main`** |
| Carries | the `npm audit` report, **any fixes the audit forces**, and the **version bump** — all three, one PR | the milestone's work, arriving whole from `v2/main`. **No commits of its own.** |
| Verified by | `npm run local:gate` | `npm run local:gate`, **plus** `npm run pack:verify` (not a gate stage), **plus** a hand-driven smoke of every contribution in the milestone, from the **production build**, written up as a **ledger artifact** |
| Merged when | reviewed and green | the ledger is reviewed by the maintainers and clean |

Then, and only then, a maintainer tags and publishes the **GitHub Release**
(step 3), which is what triggers the publish jobs.

⚠️ **Do not fold the two together.** The bump must exist on `v2/main` before the
merge (see [Why the bump goes on `v2/main` first](#why-the-bump-goes-on-v2main-first-2010)),
and PR 2 must stay a pure merge — a commit authored on the merge branch is a
change that exists downstream of `v2/main` and nothing carries it back.

## 1. PR 1 — audit, audit fixes and the bump, on `v2/main`

All three are part of the milestone's work, so all three belong on the develop
branch and flow into `main` together, **in the same PR** — audit first, so the
bump sits on top of a tree you have just checked, and so a reviewer sees the
report and the fixes it forced as one change.

```sh
# Branch from the REMOTE ref, and read the version only once you are on it.
# A default clone has just `main` checked out, so a local `v2/main` may not
# exist and `package.json` here is `main`'s — the released version, not the one
# you are bumping from (Copilot).
git fetch origin v2/main
git checkout -b v2/chore/<ISSUE>-bump-<X-Y-Z> origin/v2/main

# Audit every install that has its own lockfile — root and each client.
# REPORT ONLY. Read the output; do not let npm mutate the tree (see below).
npm audit --audit-level=high
for c in web cli tui launcher; do (cd "clients/$c" && npm audit --audit-level=high); done

node -p "require('./package.json').version"          # what is on v2/main now
npm version minor --no-git-tag-version   # or major / patch; bump only, no tag
node -p "require('./package.json').version"          # confirm, then PR → v2/main
```

Anything it reports is fixed **deliberately** — a direct bump, or an
`overrides` entry — and each fix is its own commit, gated by
`npm run local:gate` before the version bump goes on top.

⚠️ **Do not run `npm audit fix`, with or without `--force`.**
[Dependency placement](../../../AGENTS.md#dependency-placement) rules it out,
and the reason is not `--force`: plain `audit fix` resolves an advisory that has
no *upward* escape inside a declared range by silently **downgrading**. That is
not hypothetical here — `tsup@8.5.1` declares `esbuild: ^0.27.0` against an
advisory covering `0.27.3 - 0.28.0`, and `audit fix` walked three installs back
to `0.27.2` (~700 lines of lockfile churn for a low-severity dev-only advisory;
tried and reverted in #2058, written up in the `local-dev` skill). `local:gate`
does not detect a version regression, so nothing downstream would have caught
it. `--force` is worse again — it applies fixes *outside* the declared range,
trading a known vulnerability for an unvetted major.

So the release step is the **report**, and the judgment stays with a person.
Where `audit` names something with no in-range fix, pin it with `overrides`;
where it needs a major, that is its own issue and its own PR, not a release-day
edit. If something can't be resolved before the release ships, say so in the
release notes and leave it to the alert-driven pipeline (#2229) rather than
forcing it here.

This step is a **backstop, not a substitute** for #2229's alert-driven issues —
those are what surface a transitive vulnerability well before a release is cut,
tracked and fixed as their own PRs. This exists so a release is never gated on
remembering to check `npm audit` separately.

The branch name carries the version you are bumping **to**, so it is named after
that second reading. If you want it before branching:
`git show origin/v2/main:package.json | node -p "JSON.parse(require('fs').readFileSync(0)).version"`.

⚠️ **Never copy a version out of this file.** It would be a version that has
already shipped by the time you read it, and following it would cut a release
branch named for the wrong release (Copilot).

⚠️ **`--no-git-tag-version` is load-bearing.** A bare `npm version` also tags,
and the tag would land on a `v2/main` commit — but the release must be cut from
`main`, so the tag has to point at the merge commit there (step 3). Tagging here
creates a tag on a commit that is never released.

**PR 1 merges before PR 2 is opened.** The merge branch is cut from `main` and
takes `v2/main` whole, so opening it early means merging a `v2/main` that does
not yet carry the bump.

## 2. PR 2 — merge `v2/main` → `main`, smoke-test it, and write the ledger

Through the usual milestone-merge branch. It now carries the bump, so the
release lands on `main` with the version already correct.

Between steps 1 and 2 the two branches **do** differ, and that is expected, not
drift: `v2/main` reads the version being built while `main` still reads the one
currently released. What this ordering removes is *post-release* drift — once the
milestone merge lands they agree again, and `v2/main` is never left **behind**
`main`. If you see `v2/main` ahead of `main`, a release is in flight; if you see
it behind, something went wrong.

### 2a. Smoke-test the release candidate from the production build

The merge branch's tree **is** the release candidate. Check that rather than
assume it — the merge commit's tree and `origin/v2/main`'s must be identical:

```sh
git rev-parse origin/v2/main^{tree}
git rev-parse <merge-commit>^{tree}     # must print the same hash
```

Then drive it. Work from a **dedicated worktree** with its own full
`npm install` (a symlinked `node_modules` passes lint and tests and then fails
every story file), run `npm run local:gate` there, and exercise the app from the
**production build** — the packaged bin and the built bundles, not `vite dev`.
The `local-dev`, `test-servers` and `pre-push-gate` skills cover the mechanics.

**Then run `npm run pack:verify` there as its own step.** It is what proves the
tarball a consumer installs actually resolves, and ⚠️ **`local:gate` does not
run it** — `local:gate:stages` has no packaging stage, and a green gate says
nothing about the published tarball (#2380). CI runs it only in the `package`
job, which fires on the published GitHub Release — after the tag exists — so
skipping it here means the first signal of a broken package arrives too late to
stop the release. It needs network access; record its result (tarball size and
the `pack:verify OK` line) for the ledger below.

**Every contribution closed in the milestone gets driven, not read.** The bar is
observed behavior from the running app — a rendered panel, a status attribute, a
server's own stderr — against a real test server, through whichever surfaces the
change touches: the web client, the one-shot CLI, the TUI, `mcpdo` (the
connection CLI, shipped in the same package since 2.10.0) and the Docker image.
**A change to `core/cli/` is driven through both CLIs** — the one-shot CLI and
`mcpdo` share its method handlers, exit codes, OAuth flow and output styling
(#2461), so passing through one says nothing about the other. "Its tests pass"
is not evidence for this step; the gate already said that. For a change with no observable surface, the
evidence is the thing that holds it — a probe that makes the guard fire, a
counted before/after, a resolved binary path.

### 2b. The ledger artifact

Write the results up as a **published artifact** for the maintainers to review,
and link it from PR 2. Shape it like the
[v2.5.0 ledger](https://claude.ai/code/artifact/6f25d292-3623-419f-af7f-26aba57247ef):

- **Masthead** — repo, PR number and merge commit, version, date; and a
  standfirst saying what tree was tested and that its hash matches
  `origin/v2/main`, plus whether the milestone payload is complete (the only
  issue left open should be the merge itself).
- **Verdict band** — `local:gate` and `pack:verify` results, milestone issues
  verified as `N / N`, distinct test count, regressions found.
- **The automated gate** — one cell per `local:gate` stage with its number
  (file counts, test counts, smoke count), and a note on what is new this
  milestone.
- **The packaging check** — `pack:verify` in its own cell, apart from the gate
  stages because it is not one of them: its result and the tarball size.
- **One section per theme**, each a table of *Issue · What was driven ·
  Observed · Status*. One row per closed issue, issue-linked, with the actual
  output in the Observed cell.
  - **An `mcpdo` row runs against a real connection** — `mcpdo connect …`, the
    command under test, then `mcpdo disconnect …` — and its *What was driven*
    cell shows all three. ⚠️ The connection daemon (`mcpdod`) outlives a
    rebuild and keeps serving the code it started with, so a daemon left over
    from before the production build smokes the wrong bundle and the row reads
    as a pass. Run `pkill mcpdod` before the first `mcpdo` row (or rebuild with
    `npm run build:dev` in `clients/mcpdo`, which stops it); see
    `clients/mcpdo/README.md`.
- **Notes / findings** — anything that is a caveat rather than a pass, called
  out rather than folded into a row.

A row that says "verified" without saying what was run is not a ledger entry.

### 2c. When the smoke finds something

**The fix goes on `v2/main`, never on the merge branch.** File the issue, fix it
through an ordinary PR against `v2/main`, then merge `v2/main` into the merge
branch again so the fix arrives the same way everything else did. That keeps the
merge tree byte-identical to `origin/v2/main` — which is both the invariant
checked in 2a and the reason a finding here does not create a commit that only
exists downstream (#2000 → #2092; #2215 → #2216–2224).

Re-run the affected part of the smoke afterwards and update the ledger; it is
the artifact the maintainers approve the merge on.

## 3. Tag and publish the Release

### 3a. Assemble the notes and draft the Release

A release's notes have four parts, in this order:

1. **What's Changed.** GitHub's generated list of every PR since the previous tag.
2. **The smoke-ledger line**, linking the artifact from 2b.
3. **`## Known issue`** (or `issues`), only when there is one. It names the
   issue, who is affected and the workaround. Deciding what counts as a known
   issue is a maintainer judgment, so it is written by hand and passed in,
   never generated.
4. **`## Thanks for helping us improve`.** Credit to the community members whose
   issues the release addresses. GitHub adds everyone `@`-mentioned in a
   release body to that release's **Contributors** avatar strip, so the people
   credited here appear there too (confirmed on 2.9.0).

**`npm run release:notes` assembles all four and creates the Release**
(`scripts/release-notes.mjs`, #2550). It derives the version from `origin/main`
after an explicit fetch, picks the previous **stable** tag itself (this repo
also carries `-rc.N`, `-hotfix`, `-amended` and `v2-alpha-1` tags, any of which
would drop changes from the list), and asks the same `releases/generate-notes`
API the UI's *Generate release notes* button uses. Run it twice, then publish in 3b:

```sh
ARGS=(--merge-branch "v2/chore/milestone-merge-vX.Y.Z" --ledger-url "https://claude.ai/artifact/<id>")
# Add one --known-issue "<markdown paragraph>" per known issue, if any.

npm run release:notes -- "${ARGS[@]}"            # 1. preview: prints the notes, creates nothing
npm run release:notes -- "${ARGS[@]}" --draft    # 2. creates the Release as a DRAFT
```

Read the preview, then create the draft and read it again on the Releases page.
The preview prints the notes on stdout and its progress on stderr, so
`> notes.md` captures just the notes.

The rules the helper applies:

- **An issue counts when a listed PR closes it**, through either the manual
  closing link (`closingIssuesReferences`, followed across every page) or a
  closing keyword (`close`/`fix`/`resolve` in any tense, optional colon) before
  a bare `#N` in the PR body. So an issue older than the release still counts
  when this release closed it. A cross-repo `owner/repo#N` does not count.
- **Maintainers and bots are excluded by permission, not by name.** A
  maintainer is anyone with `admin`, `maintain` or `write` on the repo. Bot
  authors are dropped, which covers the issues the SDK-watch and Dependabot
  sweeps file. On a public repo, anyone without a role reads as `read`, so they
  are credited.
- **One line per person, most issues first:** `* @user (#1, #2, …)`.
- **"Addresses", not "fixes."** The credited issues include feature requests.
- **The section is left out** when no community reporter remains, as with 2.1.0.
- ⚠️ **Any API failure aborts the whole run.** A failed permission lookup never
  reads as "community", which could credit a maintainer, and a rate-limited PR
  or issue lookup is never skipped. A partial Thanks list is never published, so
  on a rate limit, wait for the reset and run it again.

To regenerate an **older** release's notes (to check them, or after editing a
PR body), pass `--version x.y.z`, and optionally `--previous-tag`. This works
for preview only. `--draft` and `--publish` refuse `--previous-tag`, and any
version other than the one on `origin/main`, because the Release would carry
the wrong range of changes or attach to the wrong tree.
Previewing `--version 2.9.0` with 2.9.0's ledger and known issue reproduces its
published notes exactly.

### 3b. Publish the Release

**Publishing is the deliberate maintainer action.** It fires `package` →
`publish` (npm) and `publish-github-container-registry`, so the helper never
does it implicitly. Publish the draft from 3a on the Releases page (*Edit →
Publish release*, with **Set as the latest release** checked), or from the CLI:

```sh
git fetch origin main      # FETCH_HEAD, not origin/main: the tracking ref can lag (see release-tag.mjs)
VERSION=$(git show FETCH_HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0)).version")
gh release edit "$VERSION" --repo modelcontextprotocol/inspector --draft=false --latest
```

A draft has no tag yet. GitHub creates the bare `x.y.z` tag **on publish**, at
`main`'s head at that moment, so publish only while `main` is still the merge
commit PR 2 landed. `npm run release:notes -- "${ARGS[@]}" --publish` creates and
publishes in one step, for when the notes were already reviewed in a preview.

The helper passes the bare `$VERSION` as the tag and `--target main`, so the tag
name and the target are right by construction.

If the tag has to exist before the Release (for example, to pin the commit
before drafting), push it first with `scripts/release-tag.mjs` (#2558). It
derives the tag from the version that just landed rather than taking one as
input, since a hard-coded tag is either already taken (so `git tag` aborts) or,
worse, wrong. A Release created afterwards attaches to that existing tag:

```sh
npm run release:tag              # dry run: prints what would be tagged
npm run release:tag -- --push    # tags origin/main's SHA and pushes the tag
# then 3a and 3b; the Release attaches to this tag
```

⚠️ **It tags `origin/main`, not your local `HEAD`.** `git checkout main && git
pull` resolves through whatever merge-or-rebase strategy you have configured,
so a divergent local `main` can quietly produce or replay local commits.
Tagging `HEAD` there tags a commit that is not on `origin/main`, and `git push
origin <tag>` pushes only the tag — leaving a release whose commit was never
published. The script resolves the SHA from `origin/main` after an explicit
fetch; the UI path avoids this by construction, since the target is `main`
itself.

⚠️ **No `v` prefix.** This repo's release tags are bare `x.y.z` — which is why
the script tags `$VERSION` and not `v$VERSION`, and why the tag typed into the
UI carries no prefix either. npm's own `tag-version-prefix` defaults to `v` and
the repo sets no `.npmrc`, so a bare `npm version` would have produced a
mismatched tag. (The workflow's assert step strips a leading `v` before
comparing, so a `v`-prefixed tag would still publish — it would just be
inconsistent with every previous release.)

The release's target commit selects which workflow runs, so this only publishes
when a release is cut from a commit carrying the v2 workflow.

**Editing a published Release's notes is safe.** Every tag's `main.yml`
triggers only on `release: types: [published]` (checked for every tag from 2.0.0
through 2.9.0), so an `edited` event never re-runs publishing. Fixing a typo or
adding a known issue after the fact needs no ceremony.

### 3c. If the release run fails

**Check npm for the exact version before anything else**, and never infer
from `dist-tags`. A freshly published version sits in **Validating** (npm's
automated review, shown on npmjs.com) for a few minutes, and during that window
`dist-tags` still shows the previous `latest`. That happened on 2.9.0. So wait
out validation, then query the version itself:
`npm view @modelcontextprotocol/inspector@$VERSION version --prefer-online`.
**Only an exact-version 404 means nothing was published.** Re-cutting a version
npm already owns cannot succeed, because the version number is immutable.

⚠️ **A release event runs the workflow from the tag's commit, not from
`main`.** Re-running a failed job therefore re-runs the same broken step. The
fix has to reach `main`, and the Release has to be re-cut at that commit. This
is what 2.9.0 needed (#2551): the first run's `publish` passed a bare
`release-tarball/…tgz` path, which npm read as a GitHub `owner/repo` shorthand.

1. **Fix it on `v2/main`** through an ordinary PR, never on the merge branch.
2. **Merge `v2/main` into `main`** in a new milestone-merge PR. Its only diff
   against the released `main` should be the fix.
3. **Delete the Release *and* its tag.** ⚠️ Deleting a Release in the UI leaves
   the tag behind. While the old tag exists, GitHub reuses it, so the re-cut
   attaches to the broken commit again, and `generate-notes` reads that commit
   too. Delete it on the remote **and locally**: `git push origin :refs/tags/$VERSION`
   and `git tag -d "$VERSION"`. A stale local tag (the 3b manual path creates one)
   makes the re-tag abort, and later makes `git fetch --tags` refuse to clobber it.
   Confirm the remote tag is gone with `gh api repos/$REPO/git/ref/tags/$VERSION`
   (expect a 404).
4. **Recreate the Release at the new `main`.** Re-run `npm run release:notes` (3a):
   What's Changed now includes the fix PRs, and a fix PR can close a
   community-reported issue, so the Thanks section can change too. Pass the
   same `--merge-branch`, `--ledger-url` and `--known-issue` arguments as before.
5. **Verify the fix before publishing again, wherever it can be verified.**
   Run the gate, and the smoke rows the fix touches, on the new tree. Only a path
   that exists solely inside a release run (like #2551's publish step) has the
   re-cut run as its first real evidence. Get as close as you can beforehand (a
   `--dry-run` with the pinned tool version), and record in the ledger which kind
   of evidence each fix has.

If npm *did* publish and a downstream job failed (the GHCR image, for example),
**do not re-cut**: that would try to publish the same npm version again.
Instead:

- **A transient failure** (a registry hiccup, a runner fault): re-run **only
  the failed job** from the run page. It re-runs at the same tagged commit and
  does not touch the npm job.
- **A defect in the tagged workflow** that cannot pass on retry: fix it on
  `v2/main` and let it ship with the next release.

## Why the bump goes on `v2/main` first (#2010)

It used to happen on the milestone-merge branch, which is cut from `main` — so
the bump existed only *downstream* of `v2/main` and nothing carried it back.
`v2/main` sat at `2.0.0` through both the 2.1.0 and 2.2.0 releases. That is not
cosmetic: a branch cut from a milestone-merge branch silently carries the bump
into an unrelated PR (this happened on #2009, where a container bugfix arrived
with a `2.0.0 → 2.2.0` diff), and anything reading the version in development
reported a version two releases old.

⚠️ **Never close a drift by merging `main` into `v2/main`.** `main` carries the
entire pre-v2 v1 history (~230 commits `v2/main` does not have), so a back-merge
grafts all of it into the develop branch's log permanently in order to deliver a
two-file change. Bumping first means there is nothing to back-merge.

## The v1 line

Flat: `feature branch → v1/main → npm v1-latest`, with no merge into `main` at
any point. The two lines publish independently under separate dist-tags, so a v1
fix does **not** need forward-porting to reach users on
`npx @modelcontextprotocol/inspector@v1-latest`.

None of the v2 machinery above applies: no milestone-merge PR, no ledger, no
`release:notes` script, no `package` job. v1 is a four-package npm workspace
(root, `client/`, `server/`, `cli/`) with its own, older workflow on `v1/main`.
This procedure was reconstructed for 1.0.3 (#2753) from the earlier releases and
that workflow, and the first attempt got the tag and the Latest flag wrong —
both are called out below.

### v1-1. Bump the version on `v1/main`

The bump is an ordinary PR against **`v1/main`**, cut from `origin/v1/main`
(the two lines have unrelated histories), labeled `v1` + `chore`, linked to a
`v1` release issue on board **#11**. That issue takes **no milestone** — every
milestone is a v2 bucket — and board #11 has no Priority field.

Edit the versions **by hand**. Don't use `npm run update-version`: its trailing
bare `npm install` re-resolves the whole tree, turning a version bump into an
uncontrolled dependency update (seen on 1.0.2, #2080). The edits are:

- `version` in the **four** `package.json` files: root, `client/`, `server/`,
  `cli/`.
- The **three** `@modelcontextprotocol/inspector-{cli,client,server}` ranges in
  the root `package.json` `dependencies` (`^X.Y.Z`).
- The **eight** matching fields in `package-lock.json`: the top-level
  `version`, `packages[""].version`, the three ranges under
  `packages[""].dependencies`, and `packages["cli"|"client"|"server"].version`.
  The `node_modules/@modelcontextprotocol/inspector-*` entries are workspace
  links with no version, so they need no edit.

Then prove the edit is complete and touched nothing else:

```sh
npm run check-version                       # every version field agrees
cp package-lock.json /tmp/lock-before.json
npm ci && cmp package-lock.json /tmp/lock-before.json   # silent: npm ci left the lockfile alone
```

Compare the lockfile against itself, not against `git status`: the bump is
still uncommitted here, so the worktree is dirty by design.

### v1-2. Merge order: the bump merges last

Merge every fix the release ships **first**, then the bump, and cut the Release
right after it. That way `v1/main` never carries the new version number without
the fixes it names, and the commit the tag lands on is the bump itself.

When the fixes are security advisories, they merge from private forks, which
have constraints of their own — required checks that can never report, and
an advisory merging all of its PRs at once. Those are in the
`security-advisory` skill, step 5.

### v1-3. Cut the Release

```sh
gh release create X.Y.Z --repo modelcontextprotocol/inspector \
  --target v1/main --title X.Y.Z --latest=false --notes-file <notes.md>
```

- ⚠️ **The tag is bare — `1.0.3`, not `v1.0.3`** — like `1.0.0` through
  `1.0.2`. The `v1 release tags` ruleset protects `refs/tags/1.*` against
  deletion and update; a `v`-prefixed tag would sit outside it, and outside the
  sequence every earlier v1 release established.
- ⚠️ **`--latest=false` is required.** Every v1 release has it. GitHub's
  "Latest" badge is repo-wide, so a v1 release marked Latest takes the badge
  from the current v2 release — and `gh release create` marks a new release
  Latest by default.
- `--target v1/main` sets where the tag is created. The tag does not exist yet,
  so without it GitHub would tag the default branch, `main`, which is v2.

### v1-4. What CI does

The `release` event runs `v1/main`'s `.github/workflows/main.yml` at the tagged
commit:

- **`build`** first.
- **`publish`** (`needs: build`) — npm **trusted publishing** over OIDC
  (`id-token: write`, no npm token), running `npm run publish-all`, which
  publishes the three workspaces and then the root, all with
  `--tag v1-latest`. That tag is what keeps a v1 publish off `latest`.
- **`publish-github-container-registry`** (`needs: build`) — the GHCR image.

### v1-5. Verify

```sh
npm view @modelcontextprotocol/inspector dist-tags --prefer-online
```

`v1-latest` must show the new version **and `latest` must still show the
current v2 release**. As with v2 (3c), a fresh version can sit in npm's
validation window before `dist-tags` moves, so query the exact version
(`npm view @modelcontextprotocol/inspector@X.Y.Z version --prefer-online`)
before concluding anything failed. Confirm the release still shows
`isLatest: false`:

```sh
gh release list --repo modelcontextprotocol/inspector --limit 100 \
  --json tagName,isLatest --jq '.[] | select(.tagName == "X.Y.Z")'
```

(`gh release view` has no `isLatest` field; `gh release list` does.)

### v1-6. Release notes for unpublished advisories

When the release ships fixes for advisories that are **not yet published**,
keep the notes **neutral** at release time: say what changed in behavior, with
no GHSA link and no description of the vulnerability. The Release is public
the moment it is created, and an advisory link there points at a page nobody
outside it can open while the notes themselves describe the bug.

Once the advisories are published (which waits on every affected line having
shipped — `security-advisory`, step 5), **edit the Release** to link each one
and thank its reporters, as 1.0.3's notes now do:

```sh
gh release edit X.Y.Z --repo modelcontextprotocol/inspector --notes-file <notes.md>
```

Re-check `isLatest` afterwards (v1-5): an edit must not hand the Latest badge
to the v1 release.
