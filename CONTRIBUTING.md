# Contributing to MCP Inspector

Thank you for your interest in improving the MCP Inspector. Contributors are
genuinely valued — the goal of this document is to channel your input into a
form we can act on quickly and consistently.

## TL;DR

**We accept issues, not pull requests.** Design and implementation are done by
the maintainers. If you've already built a fix or feature locally, share **the
prompt you used** to produce it — not the source code. This applies to everyone
outside the repo maintainers, including organization members who happen to have
write access to this repository.

## Why this policy exists

The Inspector v2 is developed with an AI-assisted, prompt-driven workflow built
around a consistent architecture, a shared design system, and strict testing
gates (see [`AGENTS.md`](./AGENTS.md)). Every component follows the same
conventions: "dumb" components that take data and callbacks as props, Mantine
for all UI, theme variants instead of ad-hoc CSS, and a uniform per-file
coverage gate of ≥ 90% on lines, statements, functions, and branches.

Accepting raw source PRs creates friction: a diff written outside this pipeline
has to be reverse-engineered to fit our component/theme conventions, coverage
gates, and review process — often it's faster to re-derive the change than to
adapt the patch. Capturing your **intent** (a well-formed issue) or the
**prompt** that generated your local change lets us reproduce the work inside
our own workflow and standards, with the quality bar already baked in.

This policy is about efficiency, not gatekeeping. Your ideas, bug reports, and
prompts directly shape what gets built. And if you'd like to contribute more
than an issue, see
[Want to work on the Inspector with us?](#want-to-work-on-the-inspector-with-us)
below — we'd rather bring you into the workflow than turn you away.

## Who opens pull requests

Pull requests against this repository are opened by the **repo maintainers**
only. That includes organization members with write access: being able to push
a branch here isn't the same as being asked to — the constraint is the workflow
described above, not permissions, so the same policy applies whether or not
GitHub would let you click the button.

If you're not a repo maintainer, open a **detailed issue** instead and a
maintainer will pick it up. If you've already prototyped the change locally,
say so in the issue and include the prompt you used (see
[If you've already fixed it locally](#if-youve-already-fixed-it-locally)) —
that's the fastest path from your work to a merged change.

**Every pull request references an issue**, including the maintainers' own. The
PR body's first line is `Closes #<ISSUE_NUMBER>`. Work is tracked on the project
board through issues, so a PR without one is invisible to the board — which is
why a well-formed issue is the useful contribution here, and why writing one is
never wasted effort.

## How to contribute a bug report or feature request

Open a well-formed issue describing the bug or the feature you have in mind.
A great issue gives us everything we need to act on it without a round-trip —
see [What makes a good issue or prompt submission](#what-makes-a-good-issue-or-prompt-submission)
below. That's the whole process: you describe the intent, we handle the design
and implementation.

[**New issue**](https://github.com/modelcontextprotocol/inspector/issues/new/choose)
offers a **Bug report** and a **Feature request** form. Blank issues are
disabled, so pick one of the two — the required fields (which client, which
version line, which transport) are exactly the facts triage needs first. The
same chooser links out to the private security-advisory process, to this
policy, and to the specification and SDK repositories for reports that aren't
about the Inspector itself.

### Which version and label?

The Inspector is maintained across two versions, each with its own base branch
and version label. File your issue against the version your report or request
targets:

| Version | Base branch | Label | npm tag      |
| ------- | ----------- | ----- | ------------ |
| v1      | `v1/main`   | `v1`  | `v1-latest`  |
| v2      | `v2/main`   | `v2`  | `latest`     |

- **v1** (`v1/main`) is the legacy Inspector — it takes **security fixes
  only**, and is published straight from that branch to the `v1-latest` npm
  tag (`npx @modelcontextprotocol/inspector@v1-latest`).
- **v2** (`v2/main`) is where all current work happens — when in doubt, target
  v2. `v2/main` is the develop branch; it is merged into `main` at milestone
  releases, and `main` is what publishes the `latest` npm tag. Nothing targets
  `main` directly.

**Label by version.** Every issue (and the PRs maintainers open for it) must
carry the label matching the target branch — `v1` for `v1/main` and `v2` for
`v2/main`. This mirrors the "Label by version" convention documented in
[`AGENTS.md`](./AGENTS.md).

## If you've already fixed it locally

Please don't send a diff or open a pull request. Instead, open an issue that
includes:

- **The prompt(s) you used** to generate the change — the exact text, so we can
  reproduce it through our own workflow.
- **A description of the behavior before and after** your change.
- **How you verified it** (steps you ran, tests you added, what you observed).

We'll reproduce the change through our pipeline so it lands with the right
conventions, tests, and coverage.

## What makes a good issue or prompt submission

A great submission gives us everything we need to act without a round-trip:

- **Clear reproduction or use case** — exact steps to reproduce a bug, or a
  concrete description of the feature and the problem it solves.
- **Expected vs. actual behavior** — what you saw, and what you expected
  instead.
- **Affected client** — which incarnation is involved: **Web**, **TUI**, or
  **CLI** (or "all" / "core" if it's shared logic).
- **Environment details** when relevant — OS, Node version, the MCP server you
  were inspecting, and any relevant config.
- **The exact prompt text**, if you generated a local change and want us to
  reproduce it.

## Want to work on the Inspector with us?

The issues-only policy is about how **unsolicited patches** are handled — it is
not a closed door. If you want to contribute at a deeper level, either in
general or in a specific area, we'd genuinely like to hear from you:

- **Join the [MCP Contributor Discord](https://discord.gg/6CSzBmMkjX)** and say
  hello in **`#inspector-dev`**. That's where day-to-day Inspector development
  is discussed and the fastest way to reach the maintainers.
- **Attend the community calls** at
  [meet.modelcontextprotocol.io](https://meet.modelcontextprotocol.io/) — see
  [Contributor Communication](https://modelcontextprotocol.io/community/communication)
  for the full set of channels and how they're used.

From there we can scope a piece of work with you and supervise it through our
workflow — which is also the path toward becoming a maintainer. What we want to
avoid is drive-by diffs that have to be reverse-engineered into our pipeline;
what we want to encourage is sustained, coordinated contribution.

All participation is governed by the MCP
[Code of Conduct](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/CODE_OF_CONDUCT.md).

## Questions

If you're unsure how to scope something, open the issue anyway and say so —
we'll help shape it. Thanks for helping make the Inspector better.
