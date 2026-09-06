---
name: pr-flow
description: Take an issue through to a merged PR in this repo, and what to do at each step. Use when asked to open, create or submit a PR; when a DCO or signoff check fails; when requesting a Copilot review or responding to review comments; when naming a branch; when attaching screenshots to a PR; or when closing out after a merge.
disable-model-invocation: false
---

# PR flow

Rules this procedure enforces live in [`AGENTS.md`](../../../AGENTS.md)
(Issue-driven Work Style, Contributing). Board mechanics are in `/board-ops`;
the gate itself is `/pre-push-gate`.

**Pull requests against this repo are opened by the repo maintainers only.**
Having write access is not authorization to open one — anyone else files a
detailed issue and a maintainer takes it from there.

## 1. Start from an issue

**Every PR references an issue. No exceptions, regardless of who opens it.** A
PR with no linked issue has no board card, so the work is invisible to the
project board and untracked. If there's no issue yet, create one first with
`/issue-create` — don't open the PR and backfill.

Move the issue's card to **In Progress** (`/board-ops`).

## 2. Branch

**Branch names start with the target version segment** — the first path segment
is the version whose base branch the PR targets, then the type, then a slug:

```
v2/fix/2071-oauth-resource-metadata
v2/chore/2146-rename-local-gate
v1/fix/proxy-ssrf-pin
```

Not `fix/oauth-resource-metadata`. This keeps the two lines legible in
`git branch -a` and in the PR list once v1 and v2 branches coexist on the same
remote, and it matches the base branches themselves (`v2/main`, `v1/main`).

**Cut the branch from the base it will target** — `v2/main` for v2 work,
`v1/main` for v1. The two lines have unrelated histories, so a `v1/fix/…`
branch cut from `v2/main` arrives at `v1/main` carrying the whole v2 tree
(Copilot). And never cut from a milestone-merge branch — it carries release-only
commits that will show up in your PR's diff.

Working in a git worktree is fine and often preferable. ⚠️ **A worktree needs a
real `npm install`, not a symlinked `node_modules`** — a symlink passes
lint/test/coverage and then fails all Storybook story files on Vite's
`fs.allow`.

For order-dependent PRs on one issue, **stack** them: each branch is based on the
previous one, not all cut from `v2/main`.

## 3. Sign off every commit

**The DCO check is a hard merge gate.** The [probot DCO
app](https://probot.github.io/apps/dco/) fails the PR unless each commit carries
a `Signed-off-by: Name <email>` trailer whose name **and** email match either the
commit's author or its committer. Its only exemptions are merge commits and
bot-authored commits; there is no partial credit — one unsigned commit out of six
fails the whole check.

**Prevent it with `git commit -s`.** Two things that look like automation and are
not:

- ⚠️ **`git config format.signOff true` does nothing here.** Despite the name it
  only defaults the `-s` flag for `git format-patch`; `git commit` never reads it,
  and there is no `commit.signoff` equivalent.
- ⚠️ **A `prepare-commit-msg` hook works, but think before installing one.** The
  trailer is a certification, and a hook makes it on your behalf for _every_
  commit, including work you merely cherry-picked. Inside that hook,
  `git var GIT_AUTHOR_IDENT` returns your config identity rather than the
  preserved author, so it cannot even tell it is signing for someone else.

**Repairing already-pushed commits** means rewriting them:

```sh
git rebase HEAD~<n> --signoff
git push --force-with-lease
```

Use `--force-with-lease` rather than `--force`, and only rewrite when you are the
sole author and nobody else has based work on the branch. The two apparent
alternatives are not alternatives: the app's empty "remediation commit" flow
requires `allowRemediationCommits.individual` and this repo ships no
`.github/dco.yml`, so it runs disabled; and the override button anyone with write
access sees only silences the check without anyone certifying anything.

The signoff is a [Developer Certificate of
Origin](https://developercertificate.org/) assertion made in **your own name**. It
does not claim you wrote the code, so signing off a cherry-pick is legitimate.
What is never acceptable is fabricating _someone else's_ certification.

## 4. Run the gate

`npm run format`, then `npm run local:gate`. See `/pre-push-gate` — `npm run
validate` is **not** a substitute.

## 5. Screenshots, for any UI change

Any change to the web UI or the TUI must show its result: capture before/after
screenshots (or a short GIF for an interaction) into a **`pr-screenshots/`
folder off the repo root**, creating it if it doesn't exist. That folder is
**gitignored** — the images are working artifacts staged for upload, never
committed — so attach them to the PR body from there rather than referencing an
in-repo path. Name them for what they show (`tools-tab-before.png`), not
`Screenshot 2026-07-31 at 14.02.11.png`.

### 5a. Capture settings — web

Everything in 5a is about a **browser** capture and assumes Playwright driving
the web client. A **TUI** change has no viewport and no `fullPage` mode: size
the terminal so no line wraps or truncates, and go straight to 5b, which applies
to every image regardless of how it was taken.

**Shoot the web client at 1280×900, full page.** It is the one size already
written down anywhere in the repo — `scripts/smoke-web-tabs.mjs` and
`scripts/smoke-web-elicitation.mjs` set exactly that viewport (the other two web
smokes set none) — and adopting it as the standard here is what makes a reviewer
comparing two PRs compare the same thing. The older shots checked into
`specification/screenshots/` were taken at assorted sizes, which is the problem,
not the precedent. Prefer a full-page shot over a
Playwright `clip` region: a clip sized to one panel cuts off anything placed
beside it, and two clips of different sizes make a before/after pair hard to
read as a pair.

⚠️ **Widening the window does not widen the Monitor sidebar.** The
main/sidebar split is a draggable divider whose width is stored independently of
the viewport (`localStorage["inspector.monitor.width"]`, default **420px**,
clamped to **320–720**), so a bigger screen grows the _content_ column and
leaves the sidebar exactly as clipped as it was. Both levers have to be set, and
only one of them is obvious. On #2234 this cost three full re-captures: the
first set clipped the sidebar, the second still clipped it after only the window
was widened, and the third worked once the divider itself was moved.

**So when a shot includes the Monitor sidebar, set its width explicitly** —
give it enough room that no row truncates, favoring the sidebar over the
left-hand list, which usually has room to give up. Two ways, in order of
preference:

```js
// Deterministic: seed the stored width before the app loads.
await context.addInitScript(() =>
  localStorage.setItem("inspector.monitor.width", "640"),
);
```

```js
// Or drive the divider itself — it is a keyboard-operable ARIA separator,
// and ArrowLeft widens the sidebar one 16px step per press.
const handle = page.getByRole("separator", {
  name: "Resize monitoring sidebar",
});
await handle.focus();
for (let i = 0; i < 14; i++) await handle.press("ArrowLeft");
```

Two more mechanics worth setting before the shutter:

- **Wait ~900ms after switching the main view.** The Servers→Tools switch is a
  crossfade, so an immediate shot renders _both_ views stacked translucently and
  reads as a broken app. Waiting on a locator in the incoming view is not enough —
  the outgoing one is still fading.
- **Mark focus when the change is about focus.** Tab order and keybinding fixes
  look identical at rest, so after driving the keystroke, `page.evaluate` over
  `document.activeElement`, outline it, and log its tag + `aria-label` — that
  line is the actual assertion and the image is the evidence. **Say in the PR
  body that the outline is script-added**, not app UI.

### 5b. Read the shot back before uploading — web and TUI

**Open every image and confirm nothing is cut off at either edge** — no
truncated row, clipped badge, or value running under a panel border, and no
half-faded view. This is a real check with your own eyes, not a formality: a
clipped screenshot is worse than no screenshot, because a reviewer reads the
truncation as a rendering bug in the feature under review and files it back at
you. Re-shoot rather than shipping one that "mostly" shows the change.

### 5c. Upload

To host them, upload to GitHub's attachment endpoint with your `gh` token. Two
mechanics, both of which bite:

- The parameters go in the **query string**, with the raw bytes as the body. A
  JSON body fails with a misleading "Invalid name for request".
- ⚠️ **Do not put the token in argv.** `-H "Authorization: token $(gh auth
token)"` puts your credential in curl's command line, where any local user or
  process can read it off the process table while the upload runs (Copilot).
  Feed it through `--config -` instead: curl reads its options from stdin, so
  the token never becomes an argument.

```sh
printf 'header = "Authorization: token %s"\n' "$(gh auth token)" | curl -sS --config - \
  -X POST --data-binary @pr-screenshots/tools-tab-after.png \
  "https://uploads.github.com/user-attachments/assets?repository_id=<REPO_ID>&name=tools-tab-after.png&content_type=image/png"
```

(The token is still in the shell's environment and in `printf`'s _stdin_, which
is not world-readable the way `/proc/<pid>/cmdline` is.)

## 6. Open the PR

Target the base branch matching the work: **`v2/main`** for v2, **`v1/main`**
for v1. Never `main`.

The body's **first line is `Closes #<ISSUE_NUMBER>`**.

```sh
gh pr create --repo modelcontextprotocol/inspector \
  --base v2/main --label v2 \
  --title "<title>" --body "Closes #<N>

<what changed and why>"
```

⚠️ Closing keywords only auto-link and auto-close for PRs targeting the repo's
**default branch** (`main`). Because v2 PRs target `v2/main`, `Closes #N` there
is only a cross-reference — it will **not** create a hard link or close the issue
on merge. Keep it anyway, so the issues close if/when `v2/main` reaches `main`.
There is no `gh` flag for manual linking; closing keywords are the only
mechanism GitHub exposes.

Move the card to **In Review**.

## 7. Request a Copilot review

Only the GraphQL `requestReviews` mutation with the Copilot **bot id** works —
REST, `gh pr edit --add-reviewer`, `userIds`, and `copilot-swe-agent` all fail or
silently drop.

```sh
PR_ID=$(gh pr view <N> --repo modelcontextprotocol/inspector --json id --jq .id)
gh api graphql -f query='
  mutation($pr:ID!,$bot:[ID!]!) {
    requestReviews(input:{pullRequestId:$pr, botIds:$bot, union:true}) {
      pullRequest { id }
    }
  }' -f pr="$PR_ID" -f bot='BOT_kgDOCnlnWA'
```

Poll for the review with a `startswith` match — the review login carries a
`[bot]` suffix. **Put that poll in one backgrounded loop that exits when the
round lands, and wait for its notification** rather than re-fetching once per
turn; a review is remote state the harness cannot observe, which is exactly the
exception described in [Waiting on long-running
work](../../../AGENTS.md#waiting-on-long-running-work) — and exactly where the
poll belongs when one is needed.

```sh
until [ "$(gh api --paginate repos/modelcontextprotocol/inspector/pulls/<N>/reviews \
  --jq '[.[]|select(.user.login|startswith("copilot-pull-request-reviewer"))]|length' \
  | awk '{s+=$1} END{print s+0}')" -ge "$EXPECTED" ]; do sleep 20; done
```

`EXPECTED` is the review **count** you are waiting to reach, not `1` — on round
two the first round's review is still there, so an existence check returns
immediately. Give the inline comments a further ~60s after the body lands; they
arrive late (see step 8).

## 8. Respond to the review

- It is **not** necessary to implement every suggestion. Implementing one a
  different way, or declining it with a reason, is fine.
- After making the changes, **respond to each comment** with what was done, or
  why it was ignored.
- ⚠️ **Inline replies go hidden once the fix is pushed** (the threads become
  outdated), so **mirror each round at PR level** as a summary comment, and always
  read the "Suppressed comments" block.
- ⚠️ **Copilot's inline comments lag its review body.** The body's "generated N
  comments" count lands first; fetch by recency and reconcile. Repeated
  re-review silence means the session ended.

## 9. Merge and close out

**On merge of a v2 PR, manually close its issue and move the board item to
Done**, since auto-close won't fire on `v2/main`. Use the move-a-card recipe in
`/board-ops` — the option IDs are unstable, so this file names the column and
nothing else.

`Done` is only for work that **shipped** — a merged PR, or a parent whose last
sub-issue closed. Anything else (duplicate, won't fix, not planned, obsolete)
means nothing shipped, so **delete the card** instead; see `/board-ops`.
