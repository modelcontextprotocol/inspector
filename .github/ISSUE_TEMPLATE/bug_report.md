---
name: Bug report
about: Report something broken in the Inspector
title: ""
labels: ""
assignees: ""
---

<!--
Issues are how work reaches the Inspector — we accept issues, not pull
requests. See CONTRIBUTORS.md for the full policy.

Please label this issue `v2` (or `v1`, if it is a security or bug fix for the
deprecated v1 line). When in doubt, it's `v2`.
-->

**Which version?**

- [ ] v2 — current, published as `@modelcontextprotocol/inspector@latest`
- [ ] v1 — deprecated, `@v1-latest` (security and bug fixes only)

**Inspector version**

<!-- e.g. 2.0.0 — the version you actually ran, not "latest" -->

**Which client?**

- [ ] Web
- [ ] CLI
- [ ] TUI
- [ ] All / shared core

**What happened**

<!-- The actual behavior you observed. -->

**What you expected instead**

**Steps to reproduce**

1.
2.
3.

<!--
If it depends on a particular MCP server, say which one and how it's
configured — transport (stdio / streamable HTTP / SSE), protocol era
(legacy / modern), and whether OAuth is involved.
-->

**Environment**

- OS:
- Node version:
- Browser (web client only):
- MCP server under inspection:

**Logs, errors, or screenshots**

<!--
Console output, the Inspector's Protocol or Network tab, or a screenshot.
Redact tokens and secrets first.
-->

**Already prototyped a fix?**

<!--
Please don't attach a diff or open a PR. Share the *prompt* you used to
produce the change, plus what you verified — we'll reproduce it through our
own workflow so it lands with the right conventions, tests, and coverage.
See CONTRIBUTORS.md → "If you've already fixed it locally".
-->
