# MCP Inspector Roadmap for 1.0

This document outlines which features and bugs we plan to include for a 1.0 release.

(Note that these aren't all in priority order.)

## Auth Developer Experience

OAuth and other auth-related debugging is especially valuable for MCP server developers. As the official debugging tool for MCP, Inspector can take advantage of working group expertise and oversight to support a robust and reliable auth debugging experience.

- TODO: see issues labeled `auth` and label any critical outstanding feature requests or open issues.
- Establish a simple process for Auth DX Working Group to help in reviewing and addressing auth-related issues and PRs going forward.

## UX Improvements (UI Mode)

- Resolve any critical tool testing issues (revisit and resolve open PRs for handling defaults, nulls, nested values).
- Resolve any critical issues with saving and/or editing server configs.
- TODO: Are there any other essential UX improvements we want to prioritize here?

## CLI Mode Parity

- Configuration parity with UI mode
- Feature parity with UI mode (excluding sampling and elicitation)

## Automation/General Process Improvements

This includes everything that isn't already mentioned in "Auth Developer Experience" above. These aren't really tied to a release version but we should still plan to review and address them in that timeframe.

- TODO: Automation with Claude Code Github Action:
  - Should we use Claude for an initial pass at issue triage/labeling?
  - Any other low hanging fruit for automation?
- TODO: Revisit how we want to label issues and PRs
- TODO: Should we be actively taking thumbs up/voting into account for feature requests?
- TODO: Playwright tests vs ad-hoc testing - what makes sense to expand here as part of CI vs doing testing on-demand?
  - Can Claude be instructed to handle additional regression testing with Playwright, etc?
