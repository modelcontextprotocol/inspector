---
name: issue-create
description: Create a tracked issue in this repo end to end — version label, type label, milestone, board card, Status and Priority. Use when asked to file, create, open or raise an issue; when picking its labels or its milestone; when checking whether one already exists; or when work discovered mid-task needs an issue of its own.
disable-model-invocation: false
---

# Creating an issue

An issue **you** create is not "created" until every step below that applies to
its version is done. A label is a repo tag, the milestone is a release bucket,
and the board is a separate org project — `--label v2` does **not** add a board
card, and adding a card does **not** set a Status or a Priority.

| # | Step | v2 | v1 |
| --- | --- | --- | --- |
| 1 | **Version label** — exactly one of `v1` / `v2` | ✅ | ✅ |
| 2 | **Type label** — exactly one of `bug` / `enhancement` / `documentation` / `chore` / `question` | ✅ | ✅ |
| 3 | **Milestone** | ✅ | ❌ — every milestone is a v2 release bucket, so there is none to take |
| 4 | **A card on the board for that version** — `v2` → #28, `v1` → #11 | ✅ | ✅ |
| 5 | **Status** on that card | ✅ | ✅ |
| 6 | **Priority** on that card | ✅ | ❌ — board #11 has no such field |

The two ❌ rows are not oversights to fix later: the field does not exist for
that line, and `AGENTS.md` states both exceptions (Copilot).

Set the labels and milestone at **create time**, never by backfilling: an
unlabeled issue belongs to no version line and appears in no version-filtered
query, and an unmilestoned one drops out of release planning silently.

**Never create a duplicate.** Check the board for a matching item first.
**Never create a draft card** (a board card with no issue number) — every board
item is a real GitHub issue.

## 0. Check the board first

Search **all** states, not just open. A closed issue is still a duplicate — it
may have been completed, rejected, or filed and superseded — and refiling it
loses that history. When one matches, the call is whether to reopen it or file
genuinely new work; either way you need to have seen it (Copilot).

```sh
gh issue list --repo modelcontextprotocol/inspector --state all --limit 1000 \
  --search "<keywords>" --json number,title,state,stateReason,labels,milestone
```

## 1. Pick the labels

**Version.** `v2` is the default for anything new. `v1` is reserved for the
narrow case of patching the deprecated line (security fixes only). If the target
version isn't obvious, it's `v2` — only ask when the issue is specifically a fix
*for released v1 behavior* and it's unclear whether v2 still has the bug.

**Type.** Independent of the version label; every issue needs both.

| Type | Use for | Not for |
| --- | --- | --- |
| `bug` | Something is broken, wrong, or regressed against its intended behavior | A missing capability that was never built |
| `enhancement` | A new capability, or extending an existing one — features, spec support, tracking issues | A cleanup with no behavior change |
| `documentation` | Prose deliverables — READMEs, guides, `specification/` docs, `AGENTS.md` rules | Code that happens to need a doc update |
| `chore` | Maintenance with no user-facing behavior change — deps, build/CI tooling, refactors | Anything a user would notice |
| `question` | An open question or discussion with no agreed deliverable yet | Work someone has already decided to do |

**Don't force the binary.** `bug` and `enhancement` are the two most reached
for, and pressing a docs task or a dependency pin into `enhancement` degrades it
to "not a bug", at which point filtering by it stops telling you anything.

## 2. Pick the milestone

If the user didn't specify one, default to the **current** milestone: the open
one with the nearest due date.

```sh
gh api repos/modelcontextprotocol/inspector/milestones --jq \
  'map(select(.state=="open")) | sort_by(.due_on) | .[] | "\(.title)\tdue \(.due_on[0:10])\topen=\(.open_issues)"'
```

Milestones are **release** buckets (`v2.1.0`, `v2.2.0`, …), so pick by *when the
work ships*, not by size. If a new issue plainly can't make the current
milestone, say so and put it in the next one rather than leaving it blank.
Sub-issues normally inherit their parent's milestone.

⚠️ **Every milestone is a v2 release bucket.** There is no v1 bucket, so a `v1`
issue cannot satisfy the milestone rule — don't drop it in a v2.x one. Leave it
unmilestoned and say so.

## 3. Create it

```sh
gh issue create --repo modelcontextprotocol/inspector \
  --title "<title>" \
  --label v2 --label bug \
  --milestone "v2.5.0" \
  --body "<body>"
```

## 4. Board it, in Todo

Filing an issue for work you intend to happen **is** approving it, so it starts
in **Todo** with its milestone already set — not in Incoming, which is the queue
for issues nobody has evaluated yet. Work you are starting immediately goes
straight to **In Progress**.

Run the **add-card recipe in `/board-ops`** with **Status → Todo** and the
Priority you scored. The project, field and option IDs live there and only
there: an option ID is regenerated whenever its field's option list is edited,
so a second copy here would go stale silently and break issue creation even
after `board-ops` was fixed.

For a **v1** issue, the same recipe against board #11 — no Priority, that board
has no such field.

The priority rubric is in `/issue-triage`.

## Note on issues that arrive from elsewhere

An issue opened through the GitHub UI — by an outside reporter *or* by a
maintainer — arrives with **no milestone and no card**, and that is normal on
arrival rather than a defect to fix the moment it lands: it comes into the
system through `/issue-triage` instead, and starts in **Incoming**, because
nobody has approved it.

Its **labels are partly set already**, which the triage pass has to account for:
blank issues are disabled, so it came through a form in
[`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE) (Copilot).

| Form | Applies | Still missing |
| --- | --- | --- |
| Bug report | `bug` | the version label — the form carries a version-line **dropdown** a maintainer reads at triage, because a `labels:` list is static and GitHub cannot map an answer to a label |
| Feature request | `enhancement`, `v2` | nothing — v1 takes security fixes only and cannot receive a feature, so `v2` is correct by construction |

So a bug report needs its version label applied from the dropdown answer, and a
feature request usually needs no label work at all. ⚠️ GitHub serves the chooser
from the **default branch**, so a form edited on `v2/main` does not take effect
until the next milestone merge.
