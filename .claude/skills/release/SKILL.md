---
name: release
description: Cut an Inspector v2 release — npm audit fix and bump the version on v2/main first, merge the milestone into main, tag origin/main with a bare x.y.z, and publish via the GitHub Release. Also covers the v1 line and what the publish jobs gate on.
disable-model-invocation: true
---

# Cutting a release

Background on what ships and why (the `files` allowlist, the bundling rules, the
container image) is in [`docs/publishing.md`](../../../docs/publishing.md). This
skill is the procedure.

A v2 release is cut from **`main`**, after the milestone's work has been merged
there from `v2/main` — not from `v2/main` itself. The v1 line releases
independently from `v1/main` to the `v1-latest` tag and never touches `main`.

Publishing is automated by two release-gated jobs in
`.github/workflows/main.yml` (`github.event_name == 'release'`), both
`needs: [build, coverage]` — so a release cannot publish with either the build
job or the coverage gate red:

- **`publish`** — runs `npm run pack:verify` as the pre-publish gate, asserts the
  release tag matches the root `package.json` version, then `npm publish
  --access public --provenance`.
- **`publish-github-container-registry`** — the GHCR image.

There is **one version number** (only the root `package.json` has one — the
clients carry none), so the flow is three steps.

## 1. `npm audit fix`, then bump, on `v2/main` — before the milestone merge

Both are part of the milestone's work, so both belong on the develop branch and
flow into `main` together, in the same PR, audit fix first.

```sh
# Branch from the REMOTE ref, and read the version only once you are on it.
# A default clone has just `main` checked out, so a local `v2/main` may not
# exist and `package.json` here is `main`'s — the released version, not the one
# you are bumping from (Copilot).
git fetch origin v2/main
git checkout -b v2/chore/<ISSUE>-bump-<X-Y-Z> origin/v2/main

# Audit + fix every install that has its own lockfile — root and each client.
npm audit fix
for c in web cli tui launcher; do (cd "clients/$c" && npm audit fix); done
npm run local:gate   # confirm the fixes didn't break anything before bumping

node -p "require('./package.json').version"          # what is on v2/main now
npm version minor --no-git-tag-version   # or major / patch; bump only, no tag
node -p "require('./package.json').version"          # confirm, then PR → v2/main
```

**Never `npm audit fix --force`.** It will apply a fix outside a dependency's
declared semver range — a major bump a client's code was never adjusted for —
to close an advisory, silently trading a known vulnerability for an unvetted
breaking change. If `npm audit` still reports something `fix` can't resolve
(typically a transitive dependency needing an `overrides` pin per
[Dependency placement](../../../AGENTS.md#dependency-placement)), commit
whatever `fix` did resolve, leave the rest to the dependabot-alert pipeline
(#2229) or a follow-up issue, and say so in the release notes rather than
forcing it here.

This step is a **backstop, not a substitute** for #2229's alert-driven issues —
those are what surface a transitive vulnerability that needs an `overrides`
entry `audit fix` cannot apply on its own, tracked and fixed as their own PRs
well before a release is cut. This step exists for whatever's left standing
right before a release ships, so a release is never gated on remembering to
check `npm audit` separately.

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

## 2. Merge `v2/main` → `main`

Through the usual milestone-merge branch. It now carries the bump, so the
release lands on `main` with the version already correct.

Between steps 1 and 2 the two branches **do** differ, and that is expected, not
drift: `v2/main` reads the version being built while `main` still reads the one
currently released. What this ordering removes is *post-release* drift — once the
milestone merge lands they agree again, and `v2/main` is never left **behind**
`main`. If you see `v2/main` ahead of `main`, a release is in flight; if you see
it behind, something went wrong.

## 3. Tag `origin/main` and draft the Release

Derive the tag from the version that just landed, rather than typing one — a
hard-coded tag is either already taken (so `git tag` aborts) or, worse, wrong:

```sh
git fetch origin main
VERSION=$(git show origin/main:package.json | node -p "JSON.parse(require('fs').readFileSync(0)).version")
echo "$VERSION"                                  # sanity-check before tagging
git tag "$VERSION" origin/main && git push origin "$VERSION"
# then draft & publish a GitHub Release for that tag → triggers `publish`
```

⚠️ **Tag `origin/main`, not your local `HEAD`.** `git checkout main && git pull`
resolves through whatever merge-or-rebase strategy you have configured, so a
divergent local `main` can quietly produce or replay local commits. Tagging
`HEAD` there tags a commit that is not on `origin/main`, and `git push origin
<tag>` pushes only the tag — leaving a release whose commit was never published.

⚠️ **No `v` prefix.** This repo's release tags are bare `x.y.z` — which is why
the command above tags `$VERSION` and not `v$VERSION`. npm's own `tag-version-prefix` defaults to `v` and the repo
sets no `.npmrc`, so a bare `npm version` would have produced a mismatched tag;
tagging by hand is what keeps it right. (The workflow's assert step strips a
leading `v` before comparing, so a `v`-prefixed tag would still publish — it
would just be inconsistent with every previous release.)

The release's target commit selects which workflow runs, so this only publishes
when a release is cut from a commit carrying the v2 workflow.

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
