---
name: security-advisory
description: "Take a privately reported vulnerability through this repo's security advisory flow — board it, verify who owns the code path, accept or reject, fix it in the private fork, ship to every affected release line, publish, then turn the card into public tracking. Use when a vulnerability is reported privately; when deciding whether an advisory is ours to fix; when looking up or creating its private fork; when answering a reporter; or when a GHSA-titled board card needs handling."
disable-model-invocation: false
---

# Handling a security advisory

Private vulnerability reporting is enabled on this repo and
[`SECURITY.md`](../../../SECURITY.md) routes every report to it — the issue
chooser deliberately has no security template, because a vulnerability report
must not open a public issue. So an advisory never arrives as an issue, and
until its fix is ready to land it must **not** become one.

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
labels, milestone and board that public tracking takes — **when the reviewed
fix is ready to land** (step 5), since the fix lands through an ordinary public
PR and that PR needs an issue to close.

⚠️ **How that tracking is created depends on the affected lines**, and only the
v2 path is a conversion: a v2 issue is **converted** from the draft (filing one
separately would duplicate both the issue and the card), while a v1 issue is
**filed** on #11, because the draft is on #28 and cannot move there. Step 5 has
the per-line sequence.

⚠️ **`/pr-flow` does not apply while the fix is in the private fork.** It
requires a public issue and a public PR against the release branch — the
disclosure this flow delays until the fix is ready. The fix is developed and
reviewed inside the private fork (step 4); once it is ready, it lands through
`/pr-flow` like any other change (step 5).

## The flow

| # | Step | Gate |
| --- | --- | --- |
| 1 | Advisory lands in state `triage` → **draft card** on board #28 | Mechanical |
| 2 | **Verify the claim** — who owns the code path, and **which release lines are affected** | Judgment |
| 3 | Valid → **accept** (`triage` → `draft`); invalid → close with a reason | **Human only** |
| 4 | Create the **private fork**, fix and review there | Mechanical |
| 5 | Turn the card into **public tracking** (convert for v2; file on #11 for v1), land the fix through an **ordinary public PR** on every affected line, release each, then **publish** the advisory | Mechanical, except **publishing: human only** |
| 6 | **After publication**, bring the public issue(s) up to date with what the advisory disclosed | Mechanical |

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
  **The card may carry the full analysis**: the vulnerability description, the
  reproduction, the ownership verdict (step 2), the affected lines and the fix
  plan. It is often the only place that analysis can live. An advisory has no
  comment API, REST or GraphQL, so research cannot be scripted into its thread,
  and the card is the one place the rest of the team can see it.
  ⚠️ **That rests on one premise: access to board #28 is managed**, so the
  people who can read a card are the people who should be handling the
  advisory. Project access and advisory access are still separate permission
  sets, and the boards are private
  ([`/issue-triage`](../issue-triage/SKILL.md)). They are not public. **If board
  access is ever widened** beyond the people handling advisories, the premise
  fails. Revisit this rule then, and go back to keeping only the link and the
  triage metadata on the card.
  ⚠️ **None of this touches disclosure.** A card is private and a converted
  issue is not. The public issue still waits until the fix is ready to land
  (step 5), and an upstream finding still goes through the upstream's
  **private** channel (step 2). A detailed card is a reason to review its body
  before converting, not a reason to convert sooner.
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
  Use the same form as an ordinary `/issue-triage` score comment: each axis
  followed by its free-text justification ("Severity 3 — a real feature is
  broken…"), the bonuses you claimed, and the total. For an advisory the
  justification is the impact and the affected surface. That is exactly what
  makes the score arguable, so it belongs on the card with the number. Leave
  the provisional score in place when you re-score and add the new one under
  it, so the change of view is legible.
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

**Then move the card `Incoming` → `Todo`.** On #28 the approval act is
normally assigning a milestone, and a draft card cannot carry one — so for an
advisory draft, **accepting the advisory is the approval**, and it is what
licenses the card to leave `Incoming`. `AGENTS.md` records this as the
advisory exemption to its `Incoming` ⇔ milestone invariant. The milestone
arrives with the public issue in step 5, where the ordinary rule resumes.

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
needs cleaning up. This was learned the hard way. The script
(`scripts/advisory-fork.mjs`, #2558) encodes that ordering: a bare run only
reads, and it creates a fork only with the explicit `--create` flag and only
when none exists:

```sh
npm run advisory:fork -- --ghsa <GHSA_ID>            # read-only probe
npm run advisory:fork -- --ghsa <GHSA_ID> --create   # create only if absent
```

⚠️ **Deleting a private fork needs the `delete_repo` OAuth scope, which a
default `gh` token does not carry.** So a fork created by mistake is not
something you can quietly undo — it takes a re-scoped token or an admin in the
UI. That asymmetry is the whole reason for the read-first rule above.

Fix and review inside the fork. Its PRs and commits are private, so none of the
normal public review flow applies there. Cut each fix branch from the base of
the line it targets (`v2/main` for v2, `v1/main` for v1), **one per line step 2
found affected** — in step 5 that branch is pushed to the public repo unchanged
and lands through an ordinary PR, so the fork's PRs are where the fix is
_reviewed_, never where it is _merged_.

⚠️ **Move the card as the work moves.** `AGENTS.md`'s lifecycle applies to this
card like any other: **`In Progress`** when the fix is started, **`In Review`**
when the fork's PR is open. The card being private is not a reason to skip it —
it is the reason to do it, since the fork is invisible to everyone who is not on
the advisory, and this card is the only place the rest of the team can see the
work exists at all. A card that sits in `Incoming` until it jumps to `Done`
reports "unreviewed, nobody committed to it" for the entire time somebody is
actively fixing it.

### 5. Land the fix on every affected line, release, publish

Publish **after** the fix has shipped in a release, never before — publishing
discloses the vulnerability, so doing it while users have no upgrade available
hands out a working exploit.

⚠️ **"Shipped" means shipped on *every* affected line.** The two lines release
independently under separate dist-tags, so v2 reaching `latest` says nothing
about `v1-latest`. Publishing with one line still unpatched discloses a live
vulnerability to the users who have no fix — and they are the users least able
to move, since v1 is the deprecated line they are on because upgrading is hard.

⚠️ **The patch stops being secret when it reaches the public repo, not at
publish — and no path changes that.** Merging from the private fork would put
the same commits on `v2/main` or `v1/main` at merge time, so going through the
fork buys no secrecy. The public flow below exposes the fix a little earlier,
when its branch is pushed and its PR opened, and the converted issue exposes
the card's title and body then too. So the window between landing and publish
is not a period of secrecy to protect; it is a period of **exposure to anyone
reading commits**, which is why it should be short. Land the fix close to the
release rather than early, and publish as soon as every release is out.

#### Landing through an ordinary public PR

The fix lands the way any other change does: a public issue, a public branch,
a `/pr-flow` PR with normal CI, the required `DCO` / `build` checks, the
Copilot loop and normal merge rules. **No ruleset is touched.** This replaced
merging from the private fork (1.0.3, #2753), which needed the
`required_status_checks` rule removed from the line's ruleset for the merge —
private forks run no Actions, so `v2/main`'s required `DCO` and `v1/main`'s
required `build` stay "Expected" forever there — left the commits unchecked by
CI, and merged all of an advisory's fork PRs (v2 and v1) at once. v2.14.0 and
1.0.4 shipped this way (#2872 / PR #2875, #2873 / PR #2876, #2874 / PR #2877
with its v1 half #2878 / PR #2879).

When the fork's review is done, per affected line:

1. **Turn the card into public tracking.** Review the card body and **trim it
   before converting** — it becomes the body of an issue on a public repo, along
   with any analysis step 1 allowed onto it. The advisory is still private, so
   keep the advisory link and the fix, and take out anything that would hand a
   reader a working exploit (a PoC, reproduction steps, a reporter's details).
   Then:

   | Affected | Public issue | Labels | Milestone | Board |
   | --- | --- | --- | --- | --- |
   | v2 | **Convert** the draft card on #28 | `v2` + a type label | the release that will ship the fix | #28 — the converted card is already there |
   | v1 | **File** through `/issue-create` | `v1` + a type label | **none** — every milestone is a v2 release bucket | **#11**, Status only (no Priority field) |
   | both | **Convert** for v2 _and_ **file** for v1, as above | | | |

   ⚠️ **Convert the v2 issue — never file it.** GitHub's "Convert to issue"
   creates a **new** issue from the draft; there is no way to point an
   existing card at an issue you filed separately. Filing the v2 issue by hand
   and then converting produces two issues and two cards. Do **not** run
   `/issue-create`'s add-card step for the converted card: it already exists.

   **For an advisory affecting both lines**, v2 takes the conversion because
   the draft is already on #28 and v2 is the line with a milestone to record.
   The v1 issue is filed, which is not a contradiction: there is no second
   draft to convert. **Cross-link the two** so neither reads as the whole
   story.

   **For a v1-only advisory** the draft is on the wrong board and cannot be
   moved there by converting: file the `v1` issue on #11, then **delete** the
   #28 draft rather than converting it — a converted card would put a `v1`
   issue on #28, which the board audit reports as a wrong-board card.
2. **Push the fork branch to the public repo** under the standard name,
   `v2/fix/<N>-<slug>` or `v1/fix/<N>-<slug>`, where `<N>` is that line's issue
   from (1). Push the fork's commits unchanged; they are already reviewed and
   must already carry their DCO signoff.
3. **Open an ordinary PR** against `v2/main` / `v1/main` with `Closes #<N>` as
   the body's first line, and follow `/pr-flow` from its step 6 on: link the
   issue, move the card to In Review, run the Copilot loop. Say in the body
   that the fix was developed and reviewed in the advisory's private fork, and
   keep the description to the fix — what the advisory will disclose is the
   advisory's to say.
   When several fix branches were chained on top of each other in the fork,
   open them as **stacked** PRs (`/pr-flow`, step 2) rather than one combined
   PR.
4. **Merge, close the issue and move its card to `Done`** (`/pr-flow`, step 9),
   then **close the fork's PRs unmerged**. The fix is on the line through the
   public PR; merging the fork's copy would land it twice.

**Then release on every affected line.** Do not hand this off to the release
skill. It is `disable-model-invocation: true`, so a pointer to it from here is
a dead end for the model anyway — a maintainer invokes `/release` themselves.
Say which lines need a release and stop there. A v1 fix takes no merge into
`main` at all and publishes straight from `v1/main`.

⚠️ **Publishing is irreversible and human-gated.** It makes the advisory
public, and there is no undo. Same rule as accepting: recommend, never perform.

**Before publishing, do the two things publishing will not do for you:**
request the **CVE** (optional, and the advisory is the only place to ask) and
**add the reporter to the credits** — a credit is an explicit addition the
person then has to accept, so an unadded reporter is simply never credited, and
that is the failure nobody notices because nothing reports it.

### 6. After publication, bring the public issues up to date

The public tracking already exists — it was created in step 5 and its issues
closed when the PRs merged — so there is nothing to convert or file here. What
publication changes is what may be said: the issue bodies were trimmed to what
was safe while the advisory was private. **Edit them only where that left them
misleading**, typically to point at the published advisory and add what it now
discloses. The cards stay in `Done`.

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
