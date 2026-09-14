---
name: issue-triage
description: Triage unboarded Inspector issues — the two-pass sweep, the priority rubric and its score comment, and the board audit that checks the whole board against its invariants. Use for "triage new issues" or when scoring an issue's Priority.
disable-model-invocation: false
---

# Triaging issues

**An issue needs triage when it has no board card — regardless of who filed
it.** That is the whole test, and it is deliberately about *state*, not
authorship. The milestone is not part of the test; it decides *where the card
lands* (milestoned → **Todo**, unmilestoned → **Incoming**), so an
approved-but-unboarded issue is still swept in rather than skipped (Copilot). An outside reporter has no board access, so their
issue necessarily lands this way — but so does a maintainer's, whenever they
open one by hand instead of through the `/issue-create` flow. Write access makes
the board *reachable*, not automatic. What puts an issue in Todo is somebody
performing the approval, and an issue nobody did that for has not been approved,
whoever's name is on it.

**"Triage new issues" means running pass 1 over every unboarded open issue, then
the board audit.** Pass 2 is a human judgment call and is never done unprompted.

## Pass 1 — sweep them onto the board (no approval implied)

For each open issue with no card:

1. Apply the **version label** (`v2` unless it's a fix for released v1 behavior)
   **and the type label** (`bug` / `enhancement` / `documentation` / `chore` /
   `question` — see `/issue-create` for the table). An outside reporter cannot
   set either, so both are applied here.
2. Add it to the board for that version — `v2` → #28, `v1` → #11.
3. Set Status to **`Incoming`**.
4. Set Priority with the rubric below (v2 only), and **record the score in a
   comment**. This is an *assessment*, not an approval — it's how the queue gets
   ordered for the maintainer who reviews it next.
5. **Leave the milestone unset.** Nobody has committed to shipping it yet, and an
   empty milestone is precisely what marks it as awaiting review.

**The one exception is an unboarded issue that already carries a milestone.**
Someone recorded the approval and only the card is missing, so board it straight
into **Todo**, keeping the milestone. Otherwise triage would silently un-approve
work a maintainer had already scheduled.

### Finding the unboarded ones

Diff the open issues against **both boards**. Diffing against #28 alone is
wrong: a `v1` issue correctly carded on #11 is reported as unboarded and gets
double-boarded (a real defect a past sweep introduced — #1929 reproduced it).

```sh
D=$(mktemp -d)
gh issue list --repo modelcontextprotocol/inspector --state open --limit 1000 \
  --json number,milestone > "$D/open.json"
# Union of BOTH boards, filtered to this repo — org boards can hold other repos' issues.
for P in 28 11; do
  gh project item-list $P --owner modelcontextprotocol --format json --limit 700 \
    | jq '[.items[] | select(.content.type=="Issue"
           and .content.repository=="modelcontextprotocol/inspector")
           | .content.number]'
done | jq -s 'add' > "$D/boarded.json"
# Prints the destination too: milestoned already → Todo, otherwise → Incoming.
jq -r --slurpfile b "$D/boarded.json" \
  '.[] | select(.number as $n | ($b[0]|index($n))|not)
   | "#\(.number)\t→ \(if .milestone then "Todo (has milestone \(.milestone.title))" else "Incoming" end)"' \
  "$D/open.json"
```

## Pass 2 — approve what should ship

A maintainer reads the Incoming column and, for each issue worth doing,
**assigns a milestone** and moves the card to **Todo** (or **In Progress** if
picking it up now). That is the whole approval gesture.

This pass is **a judgment call reserved for a human** — deciding what ships in
which release is not something to infer from a rubric. Never promote a card out
of Incoming as part of a routine sweep; "triage new issues" stops at the end of
pass 1.

Issues that shouldn't ship stay in Incoming (or get closed). **Incoming is the
review queue, and "milestoned" is the line between reviewed and not** — which is
why the milestone stays off in pass 1, and why the rubric can treat a milestone
as a real signal rather than a formality every issue carries.

## The priority rubric

Score it rather than assert it: rate two axes 1–5, add the signal bonuses, and
read the total off the band table. The point is that two people triaging the
same issue land in the same place, and that the reasoning survives in a form
someone can argue with later.

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

**Signal indicators (+1 each — not an axis of their own).** Corroborating
evidence that the two axes may have undercounted:

- Carries a `bug` or security-related label
- Linked to a milestone — i.e. **already approved**. This is the *re-scoring*
  case: an issue being scored in a pass-1 triage has no milestone yet by rule, so
  it never earns this one. If you find yourself applying it to every issue in a
  batch, the milestone is being used as a formality rather than as approval, and
  the bonus has become a constant that discriminates nothing.
- High engagement (many comments or reactions)
- Assigned to someone
- A sub-issue of a larger epic
- The reporter set `Fields → Priority` to **Urgent or High** — **+1, flat,
  whichever of the two they picked.** It does not map to a band, and `Urgent`
  earns exactly what `High` earns.

**Bands.** Axes give 2–10 and there are six bonuses, so the total runs 2–16.

| Total | Priority | Meaning |
| --- | --- | --- |
| 12+ | **Urgent** | Drop what you're doing. |
| 9–11 | **High** | Next up after current work. |
| 6–8 | **Medium** | Scheduled normally. |
| ≤5 | **Low** | Nice to have; may sit. |

Severity alone doesn't reach Urgent: a 5/5 with no corroborating signals totals
10 and lands **High**. That's deliberate — Urgent is reserved for a severe
problem that something *else* also confirms is burning, and a band that
everything qualifies for stops carrying information. Override the band when it's
plainly wrong, but say why in the issue; a rubric nobody may overrule is a rubric
people route around.

### Trust boundary: who can set what

**The boards are private** (`public: false`, both #28 and #11 — verified
2026-08-01). The Status and Priority a maintainer assigns are visible only to
people with project access: a reporter cannot see them, cannot set them, and
will never learn how their issue was scored. Board priority is a maintainers'
working queue, not a published commitment.

The org-level `Fields → Priority` is the opposite. It renders on the public
issue page and is **not** part of maintainer triage, so any value there is
**untrusted** — we didn't put it there, and it carries a preference rather than
an assessment. That asymmetry is why it earns a flat +1 and nothing more:

- **It counts for something.** Someone flagging their own issue is real
  information about how much it hurts them.
- **It cannot decide an outcome.** The bonus is capped, identical for `Urgent`
  and `High`, and can lift an issue at most one band. Nothing a reporter can type
  reaches Urgent by itself: Urgent needs 12, so the issue must already sit at 11
  on maintainer-assessed axes — at which point the reporter is not the reason.
- **Never map the value across.** A reporter selecting `Urgent` does not make the
  card Urgent. Doing that would hand queue position to anyone with a GitHub
  account, and the queue would sort by assertiveness instead of impact.

Don't lean on GitHub's permission gate to enforce this. Whether an outside
reporter can set that field today is an implementation detail that can change
without notice; the rule holds either way, because it rests on *who assessed the
issue* rather than on who was technically able to click.

### Recording the score

The board stores only the *result* — a card reading `High` with no trace of how
it got there — and since the boards are private, that result is also invisible
to the reporter. So **post the arithmetic as a comment on the issue.** Without
it, a later re-scoring has no way to tell a considered judgment from a guess.

```sh
gh issue comment <N> --repo modelcontextprotocol/inspector --body \
'**Triage:** Priority **Medium** (total 7)

- Severity 3 — a real feature is broken; workaround is partial
- Urgency 2 — wanted eventually, nothing blocked on it
- Bonuses: +1 `bug` label, +1 reporter set Fields → Priority to High

Board: #28, Status `Incoming` (awaiting maintainer review — no milestone yet).'
```

Name the bonuses you claimed rather than just summing them — the milestone bonus
in particular should be conspicuously absent on a pass-1 triage, and a comment
that lists it is a visible sign the approval semantics were misapplied.

## The board audit

Sweeping in the unboarded issues is only the most visible defect class. A board
drifts in several other ways that no single-issue rule catches, so **finish a
triage run with the audit below** — every check should print `0`. A non-zero
count means the board contradicts a rule, not that the rule needs revisiting.

| Check | Invariant | Fix |
| --- | --- | --- |
| Double-boarded | An issue has a card on **one** board, the one matching its version label | Delete the wrong-board card |
| Non-Issue items | **Only issues go on a board** — never PRs, never drafts | Delete the item |
| No Status | Every card carries a Status | Set one — `Incoming` if unmilestoned, else by where it actually is |
| `Incoming` **with** a milestone (#28) | Incoming ⇔ no milestone | Approval was never recorded: move to **Todo**, or clear the milestone |
| Past Incoming **without** a milestone (#28) | Everything past Incoming ⇔ milestoned | Claims an approval nobody made: milestone it, or move back to Incoming |
| Wrong board for label | `v1` → #11, `v2` → #28 | Move the card to the right board |
| Not exactly one version label | Every issue carries **exactly one** of `v1`/`v2` | Apply the missing one, or remove the extra |
| Not exactly one type label | Every issue carries **exactly one** of the five types | Classify it, or remove the extra |
| No Priority (#28) | Every board item is prioritized | Score it with the rubric |
| Closed, not shipped, still carded | **Done means the work shipped** | Delete the card |
| Open, but carded `Done` | A card in Done ⇒ its issue is closed | Close the issue, or move the card back |

```sh
D=$(mktemp -d); R=modelcontextprotocol/inspector
# --limit must exceed the repo's TOTAL issue count (884 as of 2026-08-05), not just the open ones —
# the last check below reads closed issues' state reasons.
gh issue list --repo $R --state all --limit 2000 \
  --json number,state,stateReason,labels,milestone > "$D/i.json"
for P in 28 11; do gh project item-list $P --owner modelcontextprotocol \
  --format json --limit 700 > "$D/b$P.json"; done
jq -nr --slurpfile o "$D/i.json" --slurpfile a "$D/b28.json" --slurpfile b "$D/b11.json" --arg R "$R" '
  ($o[0] | map({key:(.number|tostring), value:{st:.state, sr:(.stateReason // ""),
                lab:[.labels[].name], ms:(.milestone.title // null)}}) | from_entries) as $M
  | def own($s): [$s[].items[]
        # A DRAFT card has no `.content.repository`, so filtering on equality
        # alone drops the very items the "non-Issue" check exists to find.
        | select((.content.repository // null) == null or .content.repository==$R)];
    def I($n): ($M[($n|tostring)] // null);
    def ms($n): (I($n).ms // null);
    def lab($n): (I($n).lab // []);
    def isopen($n): (I($n).st == "OPEN");
    def shipped($n): (I($n).sr == "COMPLETED");
    [own($a)[] | select(.content.type=="Issue") | {n:.content.number, s:.status, p:.priority}] as $B28
  | [own($b)[] | select(.content.type=="Issue") | {n:.content.number, s:.status}] as $B11
  | {
    "double-boarded":        [$B28[].n | select(. as $n | [$B11[].n]|index($n))],
    "non-Issue on a board":  [(own($a)[], own($b)[]) | select(.content.type!="Issue") | .content.number],
    "no Status":             [($B28[], $B11[]) | select(.s==null) | .n],
    "Incoming w/ milestone": [$B28[] | select(.s=="Incoming" and ms(.n)!=null) | .n],
    "past Incoming, no ms":  [$B28[] | select(.s!=null and .s!="Incoming" and .s!="Done"
                                              and isopen(.n) and ms(.n)==null) | .n],
    "v1 label on #28":       [$B28[] | select(isopen(.n) and (lab(.n)|index("v1"))) | .n],
    "v2 label on #11":       [$B11[] | select(isopen(.n) and (lab(.n)|index("v2"))) | .n],
    "open, not exactly 1 version label":
                             [$o[0][] | select(.state=="OPEN")
                              | select(([.labels[].name] | map(select(IN("v1","v2"))) | length) != 1)
                              | .number],
    "open, not exactly 1 type label":
                             [$o[0][] | select(.state=="OPEN")
                              | select(([.labels[].name]
                                        | map(select(IN("bug","enhancement","documentation","chore","question")))
                                        | length) != 1)
                              | .number],
    "#28 open, no Priority": [$B28[] | select(.p==null and isopen(.n)) | .n],
    "closed unshipped, still carded":
                             [($B28[], $B11[]) | select(I(.n)!=null and (isopen(.n)|not)
                                                        and (shipped(.n)|not)) | .n],
    "open, but carded Done": [($B28[], $B11[]) | select(.s=="Done" and isopen(.n)) | .n]
  } | to_entries[] | "\(.value|length)\t\(.key)\t\(.value[0:10])"'
```

Two things the queries must account for, both learned the hard way:

- **Filter by repository.** These are **org** projects and can hold cards from
  any repo in the org — board #11 currently carries one
  `modelcontextprotocol/servers` issue. Without the `.content.repository` filter
  it reads as a statusless-card defect, and "fixing" it would mean editing
  another repo's tracking.
- **`Done` is checked from both sides.** One direction catches a card parked in
  Done for work that never shipped; the other catches an issue still **open**
  under a Done card. The second is not hypothetical here — closing keywords do
  not fire on `v2/main`, so every v2 issue is closed **by hand** after its PR
  merges, and forgetting that step is the normal way this breaks (Copilot). The
  other checks cannot see it: they either gate on `isopen` or skip `Done`.
- **The two milestone checks are #28-only.** Every milestone in this repo is a
  v2 release bucket, so a `v1` issue has none it could take — running the
  Incoming⇔milestone invariant over board #11 would flag every card on it for a
  state it cannot reach.
- **Count the labels; don't test for presence.** The invariant is *exactly
  one*, so a predicate that only asks "is any version label present" passes an
  issue carrying **both** `v1` and `v2` — which belongs to two lines at once
  and shows up in both filtered queries. Same for the five type labels (Copilot).
- **Keep drafts inside `own`.** A draft card carries no `.content.repository`,
  so a plain equality filter removes it before the "non-Issue" check can see it —
  and that check then reports `0` while the invariant it states (no drafts) is
  being violated (Copilot). The filter admits an item with no repository and
  excludes only cards that name a *different* one.
- **`$M` holds closed issues too** — the lookup is built from
  `gh issue list --state all`, which it has to be, because the last check reads
  closed issues' state reasons. So `isopen` is not there to cope with a missing
  entry; it is there because the *invariants* are about open work. A closed
  issue legitimately sits in `Done` with whatever milestone it had, and a check
  that did not gate on `isopen` would report every one of them (Copilot).

**Do not "fix" a `Done` card that is missing a milestone.** Cards predating a
rule are not defects to backfill in bulk — the audit exists to stop *new* drift,
and rewriting settled history destroys the record of when a rule started being
enforced.
