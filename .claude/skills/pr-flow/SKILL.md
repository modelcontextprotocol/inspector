---
name: pr-flow
description: Take an issue through to a merged PR in this repo, and what to do at each step. Use when asked to create a PR for an issue, or to open or submit one; when a DCO or signoff check fails; when running the Copilot review loop after opening a PR or responding to review comments; when naming a branch; when attaching screenshots to a PR; or when closing out after a merge.
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

**Read the issue first — the body _and every comment on it_.** The body is
where the issue started, not necessarily where it stands now. The comments are
where a maintainer narrows or widens the ask, rules out an approach, links a
related issue or records a decision the body was never updated to reflect.
Working from the body alone builds the wrong thing.

```sh
gh issue view <ISSUE_NUMBER> --repo modelcontextprotocol/inspector --comments
```

When a later comment contradicts the body, follow it **only if a maintainer
wrote it or endorsed it**. The repo is public, so anyone can comment, and a
comment from anyone else is input to weigh, never a change of scope. When the
scope is still unclear after reading everything, ask before starting. A question now is
cheaper than a PR built on a guess.

**Then two actions — assign the issue, and move its card to In Progress.
Both happen before you branch.** A card in progress with nobody on it can't
answer "who has this?", and an assigned issue whose card still says `Todo` tells
the board nobody has started. `@me` resolves to whoever `gh` is authenticated
as, so an agent assigns the maintainer it is working for.

Run the chained command. **The step is done only when it prints
`card: In Progress`** — the `&&` makes that line unreachable when the
assignment fails:

```sh
gh issue edit <ISSUE_NUMBER> --repo modelcontextprotocol/inspector --add-assignee @me \
  && npm run board:status -- --issue <ISSUE_NUMBER> --status "In Progress"   # add --board 11 for a v1 issue
```

The script (`scripts/board-card-status.mjs`, #2558) resolves every id by name
at run time — so nothing is copied from `/board-ops` and an option recreated
after a deletion (its hazard) still resolves — finds the card from the issue
rather than a board listing, edits it, re-reads it, and prints `card: <Status>`
only when the re-read confirms the move. Any other output means the step is
NOT done.

An issue with no card on that board fails the lookup; board it there first with
`/issue-create`'s card step rather than skipping the move.

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

**The `DCO` check fails the PR on any unsigned commit.** It is this repo's own
job (`.github/workflows/dco.yml` → `scripts/dco-check.mjs`, #2566), run on every
pull request, and it requires each commit to carry a `Signed-off-by: Name <email>`
trailer whose name **and** email match either the commit's author or its
committer (case-insensitively). Its only exemptions are merge commits and
bot-authored commits; there is no partial credit — one unsigned commit out of six
fails the whole check, and the job's output names each offending commit and the
repair below.

⚠️ **It is a merge gate only because it is a _required_ status check** — a
ruleset setting, not something the workflow file can declare. The job runs on
`pull_request_target`, so its workflow is read from `main`: it reports on PRs
only once a milestone merge has carried it there (#2566). The probot DCO app
it replaced was never required, so when the app was suspended its check simply
stopped appearing (after #1981) and nothing went red for two months. If the
`DCO` check is ever missing from a PR, treat that as the outage it is.

**Check before you push** — the same script runs locally against the range the
PR will show:

```sh
npm run dco:check -- --base origin/v2/main
```

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
git rebase --rebase-merges --signoff origin/v2/main   # the base the PR targets
git push --force-with-lease
```

`--rebase-merges` keeps any merge commit on the branch — without it the rebase
flattens them, silently dropping a conflict resolution that lives only in the
merge. Use `--force-with-lease` rather than `--force`, and only rewrite when you are the
sole author and nobody else has based work on the branch. There is no
remediation-commit or override path: the check reads each commit's own message,
so a later commit cannot certify an earlier one.

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

To host them, upload to GitHub's attachment endpoint with the script
(`scripts/pr-upload-screenshot.mjs`, #2558); it prints the hosted URL to embed:

```sh
npm run pr:upload -- --file pr-screenshots/tools-tab-after.png
```

Two mechanics it handles, both of which bite when done by hand:

- The parameters go in the **query string**, with the raw bytes as the body. A
  JSON body fails with a misleading "Invalid name for request".
- ⚠️ **The token never goes in argv.** A `-H "Authorization: token $(gh auth
token)"` puts your credential in a command line, where any local user or
  process can read it off the process table while the upload runs (Copilot).
  The script sends it only as a request header.

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

**So link the PR to its issue explicitly, right after creating it.** The
script (`scripts/pr-link-issue.mjs`, #2558) runs the `addCloseIssueReferences`
GraphQL mutation — a manual closing reference, the same link as the UI's
**Development** sidebar, working whatever the base branch — and verifies it by
reading the PR's `closingIssuesReferences` back. It is what puts the PR in the
card's **Linked pull requests** field, which the board shows as a column in
table views and as a chip on kanban cards. Without it a v2 card shows no PR at
all.

```sh
npm run pr:link -- --pr <N> --issue <ISSUE_NUMBER>   # prints linked: … only on a verified link
```

The link does not change how the issue closes on a v2 merge; that is still
step 9. The `removeCloseIssueReferences` mutation takes the same input and
undoes the link.

**Then move the card to In Review. Step 6 is done only when the PR is linked
_and_ the card says `In Review`.** Same script as step 1, different column —
and it takes the **issue** number, not the PR's:

```sh
npm run board:status -- --issue <ISSUE_NUMBER> --status "In Review"   # add --board 11 for a v1 issue
```

It prints `card: In Review` only when the post-edit re-read confirms the move;
any other output means this step is NOT done.

Then go straight to step 7.

## 7. Run the Copilot review loop — immediately, every PR

**Opening the PR is not the end of the task.** The next action, without being
asked, is a Copilot review loop run to exhaustion: request a review, wait for
the round to land (or for Copilot's session to end), answer it (step 8), and
request again if anything was pushed. It stops only on one of the exits in 7c.

### 7a. Request a round

Only the GraphQL `requestReviews` mutation with the Copilot **bot id** works —
REST, `gh pr edit --add-reviewer`, `userIds`, and `copilot-swe-agent` all fail or
silently drop. `scripts/pr-review-request.mjs` (#2558) owns that mutation and
the bot id:

```sh
npm run pr:review-request -- --pr <N>
```

It prints `requested: Copilot review on PR #<N>` on success and the
`pr:review-wait` invocation to run next.

### 7b. Wait for it — review posted, or session ended

A round ends one of two ways: Copilot **posts a review**, or its **pending
request disappears without one** — it failed, or occasionally has nothing to
say and posts nothing. Waiting only for the review hangs forever on the second
case, so the wait watches both, plus a hard cap. `scripts/pr-review-wait.mjs`
(#2558) implements exactly that loop. **Background it and wait for its
notification** rather than re-fetching once per turn; a review is remote state
the harness cannot observe, which is exactly the exception described in
[Waiting on long-running work](../../../AGENTS.md#waiting-on-long-running-work).

```sh
npm run pr:review-wait -- --pr <N> --expected <K>   # --timeout-minutes 25 is the default
```

Its last line is the outcome: `ROUND=posted`, `ROUND=ended-without-review`, or
`ROUND=timed-out` (all exit 0). A nonzero exit means the wait itself failed —
a `gh` failure (the script never retries blind on one, for the reason its
header records), a malformed response, or a bad argument — not a round outcome.

`--expected` is the review **count** to reach, so it is `1` only on the first
round — on round two the first round's review is still there and an existence
check would return immediately. On `ROUND=posted`, give the inline comments a
further ~60s; they arrive late (see step 8).

### 7c. Decide: another round, or stop

Answer the round per step 8 first, then:

| The round…                                                                  | Next                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| had an in-scope finding you fixed and pushed                                | Request another round (7a), `EXPECTED` + 1.                                                   |
| was clean — no inline comments, nothing in the body headline or `Suppressed comments` | **Stop.** One clean round is the end — never request a confirming round "just to be sure"; it spends Copilot tokens to re-review code nothing has changed. |
| held only findings you declined as out of scope (see below)                 | **Stop.** Nothing changed, so another round only re-argues the same scope.                    |
| `ended-without-review`                                                      | Request once more. Two in a row means Copilot's session on this PR has ended — stop.          |
| `timed-out`                                                                 | **Stop and report the round as still pending.** The request is still open, so re-running `requestReviews` for the same bot is a no-op and starts nothing new. |

"Clean" means all three channels are empty — inline comments, the body's
headline sentence, and the `Suppressed comments` block. A zero-comment round
can still name a real bug in the headline or the suppressed block — read all
three before calling it clean.

**Weigh every finding against the issue the PR closes.** Fix what is a defect
_in what this PR added_. Decline, with a reason in the thread, anything that is
pre-existing behavior, a new capability, or hardening beyond what the issue
asks for — Copilot does not converge on its own, and every fix it talks you
into beyond the issue is fresh surface for the next round, so accepting scope
creep is what makes a review cycle protracted. If a declined finding is a real
problem worth doing, file it with `/issue-create` and link it in the reply
rather than growing the PR.

When the loop stops, post a PR-level comment saying the review is closed and
why (which exit fired), and report the same in your reply to the user.

## 8. Respond to the review

- It is **not** necessary to implement every suggestion. Implementing one a
  different way, or declining it with a reason, is fine.
- After making the changes, **reply to each review comment in its own thread**
  with what was done, or why it was declined. That inline reply is the primary
  response and it is not optional — each review comment is a discussion thread
  with its own resolve state, and a reply _in_ the thread is the only thing a
  reviewer reading that thread sees. It does **not** resolve the thread:
  resolving is a separate act — the "Resolve conversation" button, or the
  `resolveReviewThread` GraphQL mutation — and it is the reviewer's to make. The
  reply is what makes resolving it defensible.

  ```sh
  # Fetch the latest Copilot round — review header + body, then every inline
  # comment as `COMMENT=<id> <path>:<line>` with its body. Pass
  # --review <REVIEW_ID> to fetch an earlier round instead.
  npm run pr:review-fetch -- --pr <N>

  # Reply into one thread, keyed by the COMMENT= id from above.
  gh api repos/modelcontextprotocol/inspector/pulls/<N>/comments/<COMMENT_ID>/replies \
    -f body='Fixed in <sha> — …'
  ```

  The script fetches by **review id** and paginates, because the unpaginated
  `/reviews` listing hides later rounds behind your own replies, and a round
  you only half fetch is a round you only half answer (#2558).

- ⚠️ **Then mirror the round at PR level, in addition — never instead.** Inline
  replies go hidden once the fix is pushed, because the threads become outdated,
  so a summary comment is what keeps the round readable afterwards. It does
  **not** discharge the per-comment replies: a rollup bullet cannot be connected
  back to the thread it answers, so the thread stays open with a finding and
  silence in it, and by round three matching bullets to comments is
  reconstruction rather than reading.
- ⚠️ Always read the **"Suppressed comments"** block in the review body. Those
  findings have no comment id, so they have no thread to reply into — the
  PR-level mirror is the only place they can be answered, and it is the one case
  where answering there is the whole response.
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
