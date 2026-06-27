# Contributing to MCP Inspector

Thank you for your interest in improving the MCP Inspector. Contributors are
genuinely valued — the goal of this document is to channel your input into a
form we can act on quickly and consistently.

## TL;DR

**We accept issues, not pull requests.** Design and implementation are done by
the maintainers. If you've already built a fix or feature locally, share **the
prompt you used** to produce it — not the source code.

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
prompts directly shape what gets built.

## How to contribute a bug report or feature request

Open a well-formed issue describing the bug or the feature you have in mind.
A great issue gives us everything we need to act on it without a round-trip —
see [What makes a good issue or prompt submission](#what-makes-a-good-issue-or-prompt-submission)
below. That's the whole process: you describe the intent, we handle the design
and implementation.

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

## Questions

If you're unsure how to scope something, open the issue anyway and say so —
we'll help shape it. Thanks for helping make the Inspector better.
