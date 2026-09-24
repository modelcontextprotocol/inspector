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

**So link the PR to its issue explicitly, right after creating it.** The
`addCloseIssueReferences` GraphQL mutation adds a manual closing reference, the
same link as the UI's **Development** sidebar, and it works whatever the base
branch. It is what puts the PR in the card's **Linked pull requests** field,
which the board shows as a column in table views and as a chip on kanban cards.
Without it a v2 card shows no PR at all.

```sh
ISSUE_ID=$(gh api graphql -F n=<ISSUE_NUMBER> -f query='query($n:Int!){
  repository(owner:"modelcontextprotocol",name:"inspector"){issue(number:$n){id}}}' \
  --jq .data.repository.issue.id)
PR_ID=$(gh pr view <N> --repo modelcontextprotocol/inspector --json id --jq .id)
gh api graphql -f query='mutation($i:ID!,$p:[ID!]!){
  addCloseIssueReferences(input:{issueId:$i, pullRequestIds:$p}){clientMutationId}}' \
  -f i="$ISSUE_ID" -f p="$PR_ID"

# Verify: the PR should list the issue.
gh api graphql -F n=<N> -f query='query($n:Int!){
  repository(owner:"modelcontextprotocol",name:"inspector"){pullRequest(number:$n){
    closingIssuesReferences(first:10){nodes{number}}}}}' \
  --jq '[.data.repository.pullRequest.closingIssuesReferences.nodes[].number]'
```

The link does not change how the issue closes on a v2 merge; that is still
step 9. `removeCloseIssueReferences` takes the same input and undoes the link.

Move the card to **In Review**, then go straight to step 7.

## 7. Run the Copilot review loop — immediately, every PR

**Opening the PR is not the end of the task.** The next action, without being
asked, is a Copilot review loop run to exhaustion: request a review, wait for
the round to land (or for Copilot's session to end), answer it (step 8), and
request again if anything was pushed. It stops only on one of the exits in 7c.

### 7a. Request a round

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

### 7b. Wait for it — review posted, or session ended

A round ends one of two ways: Copilot **posts a review**, or its **pending
request disappears without one** — it failed, or occasionally has nothing to
say and posts nothing. Waiting only for the review hangs forever on the second
case, so the wait watches both, plus a hard cap. **Put it in one backgrounded
loop that exits when the round resolves, and wait for its notification** rather
than re-fetching once per turn; a review is remote state the harness cannot
observe, which is exactly the exception described in [Waiting on long-running
work](../../../AGENTS.md#waiting-on-long-running-work).

```sh
EXPECTED=1   # the review COUNT you are waiting to reach — see below
DEADLINE=$(( $(date +%s) + 1500 ))   # 25 min; rounds normally land in 2–10
count() {
  # Capture first, so a gh failure stops the loop instead of being swallowed by
  # a pipeline. --slurp cannot be combined with --jq, hence the separate jq.
  raw=$(gh api --paginate --slurp \
    repos/modelcontextprotocol/inspector/pulls/<N>/reviews) || {
      echo "gh api failed ($?) — not retrying blind" >&2; exit 1; }
  n=$(jq '[.[][] | select(.user.login | startswith("copilot-pull-request-reviewer"))] | length' <<<"$raw") || {
      echo "jq failed ($?) on an unexpected response shape" >&2; exit 1; }
  case $n in '' | *[!0-9]*) echo "not a count: '$n'" >&2; exit 1 ;; esac
}
pending() {
  p=$(gh api graphql -f query='{repository(owner:"modelcontextprotocol",name:"inspector"){pullRequest(number:<N>){reviewRequests(first:20){nodes{requestedReviewer{... on Bot{login} ... on User{login}}}}}}}' \
    --jq '[.data.repository.pullRequest.reviewRequests.nodes[].requestedReviewer.login // empty | select(test("copilot";"i"))] | length') || {
      echo "gh graphql failed ($?)" >&2; exit 1; }
}
while :; do
  count; [ "$n" -ge "$EXPECTED" ] && { echo "ROUND=posted"; break; }
  pending
  if [ "$p" = 0 ]; then
    sleep 30; count   # the request can clear a beat before the review is visible
    [ "$n" -ge "$EXPECTED" ] && echo "ROUND=posted" || echo "ROUND=ended-without-review"
    break
  fi
  [ "$(date +%s)" -ge "$DEADLINE" ] && { echo "ROUND=timed-out"; break; }
  sleep 30
done
```

`EXPECTED` is the review **count** you are waiting to reach, so it is `1` only
on the first round — on round two the first round's review is still there and an
existence check returns immediately. `sleep 30` is the remote-API floor the rule
above sets. **Every step that can fail exits the loop rather than
retrying.** Piping the count straight into `awk` would make an auth or API error
read as a count of `0`; and a `jq` failure on an unexpected shape leaves `n`
empty, whereupon `[ "" -ge 1 ]` exits non-zero, `break` never fires, and the job
sleeps and retries forever — the same unbounded wait, reached from the other
end. A background task that can never succeed is worse than one that never
started, because it looks like progress. On `ROUND=posted`, give the inline
comments a further ~60s; they arrive late (see step 8).

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
  # Fetch the round's comments by REVIEW id — the unpaginated /reviews listing
  # hides later rounds behind your own replies.
  # --paginate: this endpoint returns 30 per page, and a round you only half
  # fetch is a round you only half answer.
  gh api --paginate repos/modelcontextprotocol/inspector/pulls/<N>/reviews/<REVIEW_ID>/comments \
    --jq '.[]|"\(.id) \(.path):\(.line)\n\(.body)"'

  # Reply into one thread, keyed by the comment id from above.
  gh api repos/modelcontextprotocol/inspector/pulls/<N>/comments/<COMMENT_ID>/replies \
    -f body='Fixed in <sha> — …'
  ```

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
