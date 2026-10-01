---
name: board-ops
description: "gh recipes for the Inspector project boards — add a card, move its Status, set or re-score its Priority, delete a card, and recover from a deleted single-select option. Covers board #28 (v2) and board #11 (v1), their node/field/option IDs, and the option-deletion hazard."
disable-model-invocation: false
---

# Board operations

The rules about *what* a card's Status and Priority should be live in
[`AGENTS.md`](../../../AGENTS.md) under **Issue-driven Work Style**. This skill is
the *mechanics*: the exact `gh` calls, the IDs, and the ways the board can be
damaged.

Related: `/issue-create` (the five-step create flow), `/issue-triage` (sweeping
unboarded issues in, the priority rubric, the board audit).

## Which board

| Version label | Board | Owner | Has a Priority field? |
| --- | --- | --- | --- |
| `v2` | [#28](https://github.com/orgs/modelcontextprotocol/projects/28) | `modelcontextprotocol` | Yes |
| `v1` | [#11](https://github.com/orgs/modelcontextprotocol/projects/11) | `modelcontextprotocol` | **No** |

Both are **org** projects, so every command takes `--owner modelcontextprotocol`.
The two projects have their own field and option IDs and none of them are
interchangeable — a #28 id passed to #11 is rejected with "option Id does not
belong to the field", so the mistake is at least loud.

## Finding a card without trusting `--limit`

⚠️ **`gh project item-list --limit N` truncates silently.** Past `N` it returns
the first `N` items with no error and no warning, so a `select` over the result
matches nothing and a card that exists reads as missing. Board #28 passed 500
items in September 2026 — double the figure quoted here two months earlier — and
the old `--limit 500` lookups reported a carded issue as unboarded and 16 GHSA
drafts as absent in one session (#2451). A limit is a guess about the board's
size; don't make the recipes depend on it being right.

- **An issue's card is looked up from the issue**, which is independent of board
  size — see [Move an existing card](#move-an-existing-card).
- **A draft card or a whole-board dump** (the GHSA lookup, the snapshot, the
  recovery dump, `/issue-triage`'s sweep and audit) genuinely needs the full
  listing. Those recipes use a limit with headroom **and** compare the result's
  `.items | length` against the `.totalCount` that `item-list --format json`
  also returns, so a truncated listing fails loudly instead of passing as
  complete. The check also catches a failed `gh` call, whose empty output has
  neither key. Where a later step reads the dump from a file, an incomplete dump
  is deleted, so that step fails on the missing file rather than running on
  partial data.

**Only issues go on a board — never PRs, never draft cards.** A PR is tracked
through the card of the issue it closes.

**The one exception is a GitHub security advisory**, tracked by a draft card
titled `[GHSA-xxxx-yyyy-zzzz] - …` because a real issue would disclose it before
a fix exists. The flow is `/security-advisory`.

⚠️ **A draft card has no repository and no issue number, so the issue-side
lookup below cannot find one**, and `item-add --url` has no URL to be given.
Look it up by **title** in the full listing instead, then feed that item id to
`item-edit` or `item-delete` exactly as usual:

```sh
GHSA=GHSA-xxxx-yyyy-zzzz   # the advisory's real id
ITEM_ID=   # never let an earlier lookup's id survive a failed one
BOARD=$(gh project item-list 28 --owner modelcontextprotocol --format json --limit 2000)
if jq -e '(.items | length) == .totalCount' <<<"$BOARD" >/dev/null; then
  ITEM_ID=$(jq -r '.items[] | select(.content.type=="DraftIssue")
        | select(.content.title | startswith("['"$GHSA"']")) | .id' <<<"$BOARD")
  [ -n "$ITEM_ID" ] || echo "no draft card titled [$GHSA] on #28" >&2
else
  echo "item-list incomplete or failed — raise --limit; not concluding anything" >&2
fi
```

Match on the **bracketed GHSA id**, not on words from the summary — a summary is
free text and two advisories can share one. Advisory drafts live on #28 only;
`/issue-triage`'s audit reports one found anywhere else.

## V2 board (#28) IDs

The project node id and the field ids are stable. The **option** ids are **not** —
they are regenerated whenever a single-select field's option list is edited (see
the hazard below). If any option id here is rejected, re-fetch:

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

| Status | Option ID | Means |
| --- | --- | --- |
| Incoming | `721a3d4c` | Arrived unboarded, awaiting review — **no milestone** |
| Todo | `fbdaf21e` | Approved (a milestone was assigned) |
| In Progress | `195df262` | Active work, whatever the surface |
| In Review | `159c8a02` | A PR is open |
| Done | `259d6aab` | **Shipped** — a merged PR, or a parent whose last sub-issue closed |

Priority option IDs — **last verified 2026-08-01**. Derive the level with the
rubric in `/issue-triage`; don't eyeball it.

| Priority | Option ID | Rubric total |
| --- | --- | --- |
| Urgent | `79628723` | 12+ |
| High | `0a877460` | 9–11 |
| Medium | `da944a9c` | 6–8 |
| Low | `d67ac7ce` | ≤5 |

## V1 board (#11) IDs

The v1 line takes security fixes only, so this board sees little traffic — but a
v1 issue still gets a card, and the same Incoming/Todo split applies.

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

There is **no Priority field on this board** — the priority rubric is v2-only.
Don't try to set one here; the field id doesn't exist.

## Recipes

### Add a card and set its fields

```sh
# Prints the item id (PVTI_…); capture it.
ITEM_ID=$(gh project item-add 28 --owner modelcontextprotocol --url <issue-url> --format json --jq '.id')

# Status → Todo (an issue you filed through the create flow is approved by definition)
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" \
  --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id fbdaf21e

# Priority → Medium
gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" \
  --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iJE4 --single-select-option-id da944a9c
```

Each `item-edit` sets **one** field, so setting both takes two calls — there is
no combined form.

For an issue swept in at triage, the only difference is Status → **Incoming**
(`721a3d4c`) and that you do **not** set a milestone.

For **v1**, the same shape against board #11:

```sh
ITEM_ID=$(gh project item-add 11 --owner modelcontextprotocol --url <issue-url> --format json --jq '.id')
gh project item-edit --project-id PVT_kwDOCt2Azc4BA5sz --id "$ITEM_ID" \
  --field-id PVTSSF_lADOCt2Azc4BA5szzgzkS-g --single-select-option-id f75ad846
```

### Move an existing card

**For a plain Status move, use the script** (`scripts/board-card-status.mjs`,
#2558) — it does everything this recipe describes (name-resolved ids,
issue-side lookup, edit, verify re-read) and prints `card: <Status>` only on a
confirmed move:

```sh
npm run board:status -- --issue <N> --status "In Review"   # --board 11 for a v1 issue
```

The manual recipe below remains for what the script does not do — capturing an
`ITEM_ID` for a **delete**, or adapting the lookup for another field — and as
the record of how the lookup works.

Look the item id up **from the issue** rather than re-adding it. An issue's
`projectItems` lists the cards it has on every board, so the lookup does not
depend on how many items the board holds (see [Finding a card without trusting
`--limit`](#finding-a-card-without-trusting---limit)). Select the card by the
board's **node id**, not its number: project numbers are per-owner, and an issue
can also sit on a user-owned project that happens to be numbered 28. Querying
through the repository also means the issue number cannot match another repo's
issue — board #11 really does carry a `modelcontextprotocol/servers` card.

**For a v1 card on #11, swap every #28 id, not just the lookup's.** #11's node
id `PVT_kwDOCt2Azc4BA5sz` goes in both the lookup's `select` and the edit's
`--project-id`; the edit also takes #11's own Status field
`PVTSSF_lADOCt2Azc4BA5szzgzkS-g` and an option id from [its
table](#v1-board-11-ids); and a delete is `item-delete 11`.

The mutation runs only on a non-empty id: `item-edit --id ""` fails with an
opaque node-resolution error rather than saying the card was not found. The
`|| ITEM_ID=` matters too — on a GraphQL error (a number that is a PR, not an
issue; a rate limit) `gh api` still prints the raw error JSON to stdout, which
would otherwise land in `ITEM_ID` as a non-empty "id". `first:100` is the
connection's maximum page; it counts the boards one issue is on, not the cards
on a board, so it has no board-size exposure.

```sh
N=<ISSUE_NUMBER>
ITEM_ID=$(gh api graphql -F n="$N" -f query='query($n:Int!){
  repository(owner:"modelcontextprotocol",name:"inspector"){issue(number:$n){
    projectItems(first:100){nodes{id project{id}}}}}}' \
  --jq '.data.repository.issue.projectItems.nodes[]
        | select(.project.id=="PVT_kwDOCt2Azc4BJVxt") | .id') || ITEM_ID=
[ -n "$ITEM_ID" ] || echo "#$N has no card on #28 (or the lookup failed)" >&2
```

Then edit it — e.g. Status → In Review, when its PR opens:

```sh
if [ -n "$ITEM_ID" ]; then
  gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$ITEM_ID" \
    --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id 159c8a02
else
  echo "no ITEM_ID — nothing edited" >&2
fi
```

### Delete a card

**`Done` means the work shipped.** An issue closed as duplicate / won't fix /
not planned / obsolete / superseded shipped nothing, so its card is **deleted**,
not parked in Done:

```sh
# ITEM_ID from the issue-side LOOKUP block in "Move an existing card" above —
# the lookup only, not the item-edit that follows it.
if [ -n "$ITEM_ID" ]; then
  gh project item-delete 28 --owner modelcontextprotocol --id "$ITEM_ID"
else
  echo "no ITEM_ID — nothing deleted" >&2
fi
```

Deleting the card removes it from the board only — **the issue itself is
untouched**, keeps its labels and comments, and stays searchable and linkable
forever. Nothing is lost; the board simply stops claiming the work was
delivered. Done is read as the record of what a milestone actually delivered, so
a duplicate sitting there makes that record wrong in a way nobody can detect
later.

The close **reason** is the machine-readable form of the same distinction.
`gh issue close --reason` accepts only `completed` and `not planned`, so
**`duplicate` must be set through the API**:

```sh
gh api repos/modelcontextprotocol/inspector/issues/<N> -X PATCH \
  -f state=closed -f state_reason=duplicate
```

(or "Mark as duplicate" in the web UI, which additionally records a
duplicate-of link).

## ⚠️ The option-deletion hazard

**Never add, rename, or remove an option on a single-select board field (Status
or Priority) with the `updateProjectV2Field` GraphQL mutation unless you pass
every existing option's `id`.** That mutation does a **full replace** of the
option list: resending options by name/color/description without their `id`s
makes GitHub **delete all existing options and mint new ones**, which **orphans
that field's value on every card on the board** *and* invalidates every option
id in the tables above. This has happened once, on Status (~197 items
reconstructed by inference).

Safe alternatives, in order of preference:

1. **Add or rename an option in the GitHub web UI** (Project → the field's
   settings). This preserves the ids of untouched options.
   ⚠️ **Deleting is different, in the UI as much as in the API**: removing an
   option blanks that field's value on every card that held it, with no undo and
   no warning that says so.
2. If you must script it, first `gh api graphql` the current options **with their
   `id`s**, then call `updateProjectV2Field` echoing back every existing option
   **including its `id`**, appending only the new one.
   `ProjectV2SingleSelectFieldOptionInput.id` is an optional `String`, so a mixed
   list works. Verify afterward that no card lost its value — snapshot
   `gh project item-list … --format json --limit 2000` before and after, check
   each is complete the way the snapshot below does, and diff; don't just
   spot-check. Send those dumps to `$BOARD_TMP` too, for the reason above.

Both the `Incoming` Status option and the Urgent/High/Medium/Low Priority
options were added this way (#1891), with the before/after diff confirming all
264 cards kept their Status.

`gh project item-add` and `gh project item-edit` are always safe — they set a
card's value and never touch the field schema.

### Always snapshot before touching a field's options

One command, and it is the difference between a five-minute restore and
reconstructing statuses by inference:

⚠️ **Write it outside the repo.** [The boards are private](../issue-triage/SKILL.md),
so a snapshot is a full dump of item IDs and every card's Status and Priority.
Left in the working tree it is one `git add -A` away from being published in a
PR (Copilot).

```sh
BOARD_TMP=$(mktemp -d)
gh project item-list 28 --owner modelcontextprotocol --format json --limit 2000 \
  > "$BOARD_TMP/board-snapshot.json"
# A truncated snapshot cannot restore the cards it dropped — refuse to proceed on one.
jq -e '(.items | length) == .totalCount' "$BOARD_TMP/board-snapshot.json" >/dev/null \
  && echo "snapshot: $BOARD_TMP/board-snapshot.json" \
  || { echo "SNAPSHOT INCOMPLETE — raise --limit and retake it before editing options" >&2
       rm -f "$BOARD_TMP/board-snapshot.json"; false; }
```

Note the printed path; you need it to recover.

### Recovering from a deleted option

This has happened twice — once via the API (~197 items, reconstructed by
inference) and once via the UI (the `Done` column, 247 items, restored from a
snapshot in minutes). With a snapshot the recovery is mechanical.

The recipe below is written for a deleted **Status** option. For a deleted
**Priority** option it is the same three steps with two substitutions: read
`.priority` instead of `.status` (`gh project item-list --format json` exposes
each single-select field under its lowercased name, so both keys are present),
and pass the Priority field id `PVTSSF_lADOCt2Azc4BJVxtzg5iJE4`.

```sh
# 0. Same temp dir the snapshot went to — keep every dump out of the worktree.
BOARD_TMP=${BOARD_TMP:-$(mktemp -d)}

# 1. Which cards lost their value, and what did they hold? lost-ids.json is
#    kept ONLY when the dump is complete AND the snapshot reports what those cards
#    held — step 3 refuses to run without it, so neither a truncated dump nor a
#    missing snapshot can turn into a silent no-op or an unconfirmed re-apply.
rm -f "$BOARD_TMP/lost-ids.json"
gh project item-list 28 --owner modelcontextprotocol --format json --limit 2000 \
  > "$BOARD_TMP/board-broken.json"
if jq -e '(.items | length) == .totalCount' "$BOARD_TMP/board-broken.json" >/dev/null; then
  jq -r '[.items[]|select(.status==null)|.id]' "$BOARD_TMP/board-broken.json" \
    > "$BOARD_TMP/lost-ids.json" || rm -f "$BOARD_TMP/lost-ids.json"
  jq -r --slurpfile L "$BOARD_TMP/lost-ids.json" '($L[0]) as $lost
    | [.items[] | select(.id as $i | $lost|index($i)) | .status // "(none)"]
    | group_by(.) | map({s:.[0],c:length}) | .[] | "was \(.s): \(.c)"' \
    "$BOARD_TMP/board-snapshot.json" \
    || { echo "no usable snapshot — cannot confirm what these cards held; not re-applying" >&2
         rm -f "$BOARD_TMP/lost-ids.json"; }
else
  echo "board-broken.json INCOMPLETE — raise --limit and re-run step 1" >&2
  rm -f "$BOARD_TMP/board-broken.json"
fi

# 2. Recreate the option, echoing every surviving option's id (see above).
#    NOTE: the recreated option gets a NEW id — the deleted one never comes back.

# 3. Re-apply it to the orphaned cards.
if [ -s "$BOARD_TMP/lost-ids.json" ]; then
  for id in $(jq -r '.[]' "$BOARD_TMP/lost-ids.json"); do
    gh project item-edit --project-id PVT_kwDOCt2Azc4BJVxt --id "$id" \
      --field-id PVTSSF_lADOCt2Azc4BJVxtzg5iI8c --single-select-option-id <NEW_OPTION_ID>
    sleep 0.4
  done
else
  echo "no lost-ids.json — step 1 did not complete; nothing re-applied" >&2
fi
```

Step 1's grouping is the safety check: confirm the orphaned set is exactly the
cards that held the deleted option, so you don't overwrite a card someone
legitimately moved in the meantime.

Because the recreated option carries a **new id**, the tables above and every
reference to it must be updated in the same change — `grep` the old id across
the repo. The `Done` id has been `248a3910` and is now `259d6aab` for exactly
this reason.

## ⚠️ Two different "Priority" fields

An issue page shows two fields named Priority, and they are unrelated. **Ours is
the one under _Projects → Inspector V2_.**

| Where it appears | What it is | Ours? |
| --- | --- | --- |
| **Projects → Inspector V2 → Priority** | The **project board** field on #28 (`PVTSSF_lADOCt2Azc4BJVxtzg5iJE4`) | ✅ Yes |
| **Fields → Priority** (above _Projects_) | A GitHub **issue field**, `IFSS_kgDOAdAWeg`, defined at the **org** level and shared by every repo in it | ❌ No |

Nothing syncs them, in either direction, and they will happily disagree.
**Never delete the org-level field** — it belongs to the whole org. Don't set it
either; a value there is a *reporter's* opinion and feeds the rubric as a capped
+1 signal bonus and nothing more (see `/issue-triage`).
