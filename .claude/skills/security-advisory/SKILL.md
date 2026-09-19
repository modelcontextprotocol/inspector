---
name: security-advisory
description: "Take a privately reported vulnerability through this repo's security advisory flow — board it, verify who owns the code path, accept or reject, fix it in the private fork, ship to every affected release line, publish, then turn the card into public tracking. Use when a vulnerability is reported privately; when deciding whether an advisory is ours to fix; when looking up or creating its private fork; when answering a reporter; or when a GHSA-titled board card needs handling."
disable-model-invocation: false
---

# Handling a security advisory

Private vulnerability reporting is enabled on this repo and
[`SECURITY.md`](../../../SECURITY.md) routes every report to it — the issue
chooser deliberately has no security template, because a vulnerability report
must not open a public issue. So an advisory never arrives as an issue, and for
most of its life it must **not** become one.

Two steps in this flow are **outward-facing, and both stay human-gated**:
**accepting** an advisory (the reporter sees it) and **publishing** it (it
becomes public, and there is no unpublish). Never automate either, never
bulk-apply them, and never take either step because a checklist said to.
Everything else here is mechanics.

⚠️ **A CVE and the credits are *choices made at publish time*, not effects of
publishing.** Requesting a CVE is an optional action on the advisory, and a
credit appears only when someone is explicitly added **and accepts** it. They
are named here because they are the parts a maintainer must not forget — the
reporter's credit especially, since nothing prompts for it — not because
publishing performs them.

Related: `/board-ops` (the card IDs and recipes) and `/issue-create`, for the
labels, milestone and board that public tracking takes — **after publication,
never merely after the release**, since the release ships the fix while the
advisory may still be private.

⚠️ **How that tracking is created depends on the affected lines**, and only the
v2 path is a conversion: a v2 issue is **converted** from the draft (filing one
separately would duplicate both the issue and the card), while a v1 issue is
**filed** on #11, because the draft is on #28 and cannot move there. Step 6 has
the per-line sequence.

⚠️ **`/pr-flow` does not apply to the fix itself.** It requires a public issue
and a public PR against the release branch — the disclosure this flow exists to
delay. The fix is reviewed inside the private fork (step 4), and `/pr-flow`
becomes relevant only once the advisory is published.

## The flow

| # | Step | Gate |
| --- | --- | --- |
| 1 | Advisory lands in state `triage` → **draft card** on board #28 | Mechanical |
| 2 | **Verify the claim** — who owns the code path, and **which release lines are affected** | Judgment |
| 3 | Valid → **accept** (`triage` → `draft`); invalid → close with a reason | **Human only** |
| 4 | Create the **private fork**, fix and review there | Mechanical |
| 5 | Merge **to every affected line**, release each, then **publish** the advisory | **Human only** |
| 6 | **After publication**, turn the card into public tracking — per line: convert (v2), or file on #11 and delete the draft (v1) | Mechanical |

### 1. Board it as a draft card

An advisory is private, so a public issue tracking it would disclose it before a
fix exists. It therefore gets a **draft card** — the one documented exception to
[`AGENTS.md`](../../../AGENTS.md#issue-driven-work-style)'s "every board item is
a real GitHub issue".

- **Title:** `[GHSA-xxxx-yyyy-zzzz] - <advisory summary>`. That `[GHSA-` prefix
  is not cosmetic: the board audit in `/issue-triage` keys its draft carve-out
  on it, so a card titled any other way is reported as a stray draft.
- **Body:** `**Advisory:** <html_url>` on the first line, then severity and
  reported date. The link first, because a maintainer reading the card has no
  other route back to the private advisory.
  ⚠️ **Do not copy the vulnerability description onto the card.** Project
  access and advisory access are **separate permission sets**, so the board's
  audience is not the advisory's audience — anyone with project access reads
  the card, whether or not they are an advisory collaborator. The boards are
  private ([`/issue-triage`](../issue-triage/SKILL.md)), so this is a wider
  audience than intended rather than a public leak, but a reproduction or a PoC
  is the part worth keeping to the people handling it. The card carries the
  **link and triage metadata only**; the link is how a reader with access gets
  the details, and the absence of details is how a reader without access is
  told they do not have them.
- **Status `Incoming`**, plus a **provisional** Priority scored with the
  `/issue-triage` rubric. `Incoming` is correct even though somebody clearly
  triaged it to make the card: nobody has approved shipping a fix yet, and a
  draft card has no milestone to carry the approval.
  ⚠️ **Provisional is not a hedge — it is the only honest score at this
  point.** The rubric's first axis is *severity*, and step 2 says ownership is
  established **before** severity, precisely because #2409 looked severe right
  up until it turned out not to be ours. At step 1 you have a report and
  nothing verified, so score what the report claims, mark it provisional in the
  body, and **re-score it at the end of step 2**, when you know whether the
  code is ours and which lines it reaches. An advisory that turns out to be
  upstream has its card deleted rather than re-scored (step 3).
  ⚠️ **Put the score's arithmetic in the draft body**, marked provisional and
  dated. `/issue-triage` says to record it as an issue comment, and a draft
  card has no comments — so without this the Priority is a bare word with
  nothing behind it, and the step-2 re-score cannot tell what it is revising.
  Write the two axes, the bonuses you claimed, and the total, exactly as the
  comment form would; leave the provisional line in place when you re-score and
  add the new one under it, so the change of view is legible.
  ⚠️ **Set both fields.** The board audit's non-Issue check now exempts
  `[GHSA-` drafts, so a half-made card no longer trips it; the audit carries a
  narrow replacement check (see `/issue-triage`) and it is the only thing
  looking.

The card is made **by hand**. There is no `PROJECT_TOKEN` in this org and
`organization projects: write` is a permission `GITHUB_TOKEN` structurally
cannot hold, so a board write is unreachable from Actions — the same constraint
`AGENTS.md` records for the dependency sweeps. **Do not propose a nightly
workflow for this;** that approach was tried and abandoned for exactly this
reason.

```sh
# --paginate: this endpoint returns 30 per page, and an inventory that silently
# stops at the first page is worse than none — it reads as "nothing pending".
gh api --paginate repos/modelcontextprotocol/inspector/security-advisories \
  --jq '.[] | select(.state=="triage")
        | "\(.ghsa_id)\t\(.severity)\t\(.summary)"'
```

### 2. Verify the claim — who owns the code path, and which lines it affects

Before assessing severity, establish that the vulnerable code is **ours**. A
report can be entirely accurate about behavior the Inspector merely exhibits
because an SDK does it.

⚠️ **This is not hypothetical.** #2409 — a loopback/HTTPS-exemption finding —
read as an Inspector defect and turned out to live in
`@modelcontextprotocol/client` (`typescript-sdk#2591`). The reporter withdrew
it. Had ownership been checked after the severity assessment rather than before,
the fix would have been written against the wrong repo.

So: reproduce it, find the code, and check whether that code is first-party or
reached through a dependency. An advisory against upstream code is not ours to
accept or publish.

⚠️ **"Upstream's problem" is not a reason to say it in public.** A genuine
unfixed vulnerability handed to a public upstream issue is disclosed — by us,
on someone else's behalf, before they have a fix. Route it through **that
project's own private reporting channel** (its `SECURITY.md`, or its advisory
form), and only reference a public upstream issue once the upstream has
published. Where the reporter would rather carry it over themselves, say so and
let them. #2409 took the benign version of this path: the reporter withdrew the
report here and raised it upstream.

#### Which release lines are affected — ask it here, not at merge time

⚠️ **An advisory is very nearly the only work the v1 line ever receives**, so
this is exactly where assuming v2 does the most damage. `SECURITY.md` supports
v1 for **security fixes only**, published under the `v1-latest` dist-tag, and
its "What to Include" asks the reporter to state "whether it affects v2, v1, or
both". Read what they said and then check it yourself — it is a request, not a
required form field, so it is often absent and it is never authoritative when
present. A v1-only advisory assumed to be
v2 gets merged to a branch where the bug does not exist, and one affecting both
lines leaves v1 **unpatched** while the advisory is published, which is the
worst outcome this whole flow can produce.

So the outcome of step 2 is a **set** of affected lines, and each one is
shipped on its own terms:

| Line | Branch | Flow | Publishes to |
| --- | --- | --- | --- |
| v2 | `v2/main` | `fix branch → v2/main → (milestone) main` | `latest` |
| v1 | `v1/main` | `fix branch → v1/main`, flat — **no merge into `main`** | `v1-latest` |

**The two lines publish independently under separate dist-tags, so a v1 fix is
not forward-ported** — if v2 is affected too, that is a second fix on `v2/main`,
not a merge. Branch names carry the version segment either way
(`v1/fix/…`, `v2/fix/…`).

**Now re-score the card's Priority**, replacing the provisional one from step 1.
This is the first point at which the rubric's severity axis has anything solid
under it: you know the code is ours, you have reproduced it, and you know how
many lines it reaches — and "affects both lines" is itself a severity input the
provisional score could not have had.

### 3. Accept, or close

**Valid and ours → accept.** In the UI this is "Accept and open as draft"; it
moves the advisory `triage` → `draft`. The state is readable as `state` and
`submission.accepted` on the API object.

**Invalid, out of scope, or upstream → close** with a comment saying which, and
why. A reporter who is told nothing reasonably assumes they were ignored.

⚠️ **Closing an advisory leaves its draft card behind — delete it.** Nothing
shipped, so `Done` would be a false record and `Incoming` would claim work is
still queued; `AGENTS.md` deletes a card in exactly this situation, and a
rejected advisory's card is now invisible to the audit's non-Issue check by
construction. The delete recipe is in `/board-ops`.

⚠️ **Accepting is a human act, always.** It is visible to the reporter and it
commits this project to treating the report as a real vulnerability. Nothing in
this skill authorizes taking it — surface the recommendation and let a
maintainer click.

⚠️ **There is no comment API for security advisories.** Not in REST (the
advisory object exposes no comments endpoint) and not in GraphQL
(`RepositoryAdvisory` is not commentable, and no advisory-comment mutation
exists). Comments are **UI-only**, so every exchange with a reporter is manual —
you cannot script the reply, and you cannot read the thread back with `gh`.

### 4. The private fork

Accepted advisories are fixed in a **private fork** GitHub creates for the
advisory: a private repo named `<repo>-<ghsa-id>` in the org.

⚠️ **Read `private_fork` FIRST. The POST is not a probe — it CREATES one.**
Calling it to "check whether a fork exists" makes one, in the org, which then
needs cleaning up. This was learned the hard way.

```sh
# Idempotency check — does one already exist?
gh api repos/modelcontextprotocol/inspector/security-advisories/<GHSA_ID> \
  --jq '.private_fork // "none"'

# Only if that printed "none":
gh api -X POST \
  repos/modelcontextprotocol/inspector/security-advisories/<GHSA_ID>/forks
# → 202 Accepted; the fork appears shortly afterwards.
```

⚠️ **Deleting a private fork needs the `delete_repo` OAuth scope, which a
default `gh` token does not carry.** So a fork created by mistake is not
something you can quietly undo — it takes a re-scoped token or an admin in the
UI. That asymmetry is the whole reason for the read-first rule above.

Fix and review inside the fork. Its PRs and commits are private, so none of the
normal public review flow applies; the diff comes back as an ordinary commit at
merge time, **to the branch of each line step 2 found affected** — `v2/main`
for v2, `v1/main` for v1.

⚠️ **Move the card as the work moves.** `AGENTS.md`'s lifecycle applies to this
card like any other: **`In Progress`** when the fix is started, **`In Review`**
when the fork's PR is open. The card being private is not a reason to skip it —
it is the reason to do it, since the fork is invisible to everyone who is not on
the advisory, and this card is the only place the rest of the team can see the
work exists at all. A card that sits in `Incoming` until it jumps to `Done`
reports "unreviewed, nobody committed to it" for the entire time somebody is
actively fixing it.

### 5. Merge to every affected line, release, publish

Publish **after** the fix has shipped in a release, never before — publishing
discloses the vulnerability, so doing it while users have no upgrade available
hands out a working exploit.

⚠️ **"Shipped" means shipped on *every* affected line.** The two lines release
independently under separate dist-tags, so v2 reaching `latest` says nothing
about `v1-latest`. Publishing with one line still unpatched discloses a live
vulnerability to the users who have no fix — and they are the users least able
to move, since v1 is the deprecated line they are on because upgrading is hard.

⚠️ **The patch stops being secret at MERGE, not at publish — and no release
path changes that.** Merging the private fork puts an ordinary public commit on
`v2/main` or `v1/main`, readable by anyone, and a v2 release then moves it
through **two public PRs** on its way to `main`. So the window between merge and
publish is not a period of secrecy to protect; it is a period of **exposure to
anyone reading commits**, which is why it should be short. Merge close to the
release rather than early, and publish as soon as the release is out.

**Do not hand this off to the release skill.** It is `disable-model-invocation:
true`, so a pointer to it from here is a dead end for the model anyway — a
maintainer invokes `/release` themselves. Say which lines need a release and
stop there. A v1 fix takes no merge into `main` at all and publishes straight
from `v1/main`, so it does not go through that procedure.

⚠️ **Publishing is irreversible and human-gated.** It makes the advisory
public, and there is no undo. Same rule as accepting: recommend, never perform.

**Before publishing, do the two things publishing will not do for you:**
request the **CVE** (optional, and the advisory is the only place to ask) and
**add the reporter to the credits** — a credit is an explicit addition the
person then has to accept, so an unadded reporter is simply never credited, and
that is the failure nobody notices because nothing reports it.

### 6. After publication, turn the card into public tracking

**The trigger is publication, not the release.** The release ships the fix
while the advisory can still be private, and a public issue opened in that gap
describes a vulnerability the advisory has not disclosed yet. Wait for step 5
to finish.

Once it has, the work becomes ordinary board history — by conversion for v2, by
filing for v1.

⚠️ **Convert FIRST — the order is not interchangeable.** GitHub's "Convert to
issue" creates a **new** issue from the draft; there is no way to point an
existing card at an issue you filed separately. Filing the issue by hand and
then converting produces two issues and two cards, which is why this step reads
the way it does:

1. **Convert the draft card to an issue** on board #28 (the card keeps its
   place and its field values; the issue is created from the card's title and
   body).
2. Apply a **type label** and the **version label of the line the fix shipped
   on**, then a milestone — and those two are not independent:

   | Affected | Version label | Milestone | Board |
   | --- | --- | --- | --- |
   | v2 | `v2` | the release the fix shipped in | #28 — the converted card is already there |
   | v1 | `v1` | **none** — every milestone is a v2 release bucket | **#11**, which has no Priority field |
   | both | **two issues**, one per line — see below | | |

   Do **not** run `/issue-create`'s add-card step for the converted card: it
   already exists.

   **The draft converts exactly once, so "both" needs a stated order.** Every
   issue carries exactly one version label and lives on one board, and there is
   only ever one draft card — so one line inherits it and the other gets a
   fresh issue:

   1. **Convert the draft into the `v2` issue on #28.** v2 takes the
      conversion because the draft is already on #28 and v2 is the line with a
      milestone to record.
   2. **File the `v1` issue separately** through `/issue-create` — `v1`, a type
      label, **no milestone**, and a card on **#11** (Status only; that board
      has no Priority field). This one *is* filed rather than converted, which
      is not a contradiction of step 6: there is no second draft to convert.
   3. Cross-link the two so neither reads as the whole story, then **close
      both** and move both cards to `Done`.

   **For a v1-only advisory** the draft is on the wrong board and cannot be
   moved there by converting: file the `v1` issue on #11 as in (2), then
   **delete** the #28 draft rather than converting it — a converted card would
   put a `v1` issue on #28, which the board audit reports as a wrong-board
   card.
3. **Close it.** The work shipped before the issue existed.
4. Move the card to **`Done`** — correct here, because the fix genuinely
   shipped.

## API facts worth not re-deriving

All verified against the live API.

| Thing | Fact |
| --- | --- |
| States | `triage` → `draft` (accepted) → `published`; or `closed` |
| Accepted? | `submission.accepted` on the advisory object, alongside `state` |
| Private fork | `POST …/security-advisories/{ghsa_id}/forks` → `202`, private repo `<repo>-<ghsa-id>` in the org |
| Fork idempotency | Read `.private_fork` first — the POST creates, it does not probe |
| Fork deletion | Needs the `delete_repo` OAuth scope; a default `gh` token lacks it |
| Comments | **No API at all**, REST or GraphQL. UI-only |
| Board writes | Not automatable — no `PROJECT_TOKEN`, and `GITHUB_TOKEN` cannot hold `organization projects: write` |
| Affected lines | `SECURITY.md` **asks** for v2 / v1 / both — a request, not a required field. Read it, never rely on it |
