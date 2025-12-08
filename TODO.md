# Inspector V2 - TODOs

## UI Work Items

See **[ISSUES.md](ISSUES.md)** for the full breakdown of 19 UI issues organized by phase:
- Phase 1: Home Screen Experience (5 issues) - PRIORITY
- Phase 2: OAuth Experience (2 issues)
- Phase 3: History Screen Polish (4 issues)
- Phase 4: Feature Screen Polish (3 issues)
- Phase 5: Logging and Tasks Polish (2 issues)
- Phase 6: Error Handling UX (2 issues)
- Phase 7: Experimental Features (1 issue)

## Waiting On

- [ ] **Conformance testing** - Needs coordination with Paul/Tobin before starting

## Bugs

- [ ] **[Shadcn] Dropdown menu transparent background** - See ISSUES.md UI-1

## Pending Decisions

- [ ] Decide Mantine vs Shadcn after UI review (see build sizes in claude-progress.md)
- [ ] Shadcn Badge needs `success`/`error` variant styling (currently unstyled)
- [ ] Test dark mode on both prototypes
- [ ] Prototype reference auth servers (covers OAuth, API key, etc.)

## Deferred (Not V2 Scope)

- Built-in code execution mode
- Multiple concurrent server connections
- Sidebar navigation

## Completed

- [x] Review specification docs in `inspector/specification/`
- [x] Scout V2-labeled issues for work items
- [x] Mantine vs Shadcn demo prototypes (v2/prototype/mantine, v2/prototype/shadcn)
- [x] Port spec alignment pages to Mantine (Logs, Tasks, History, Tools, Resources)
- [x] Port modals to Mantine (ServerInfoModal, AddServerModal, ImportServerJsonModal)
- [x] Playwright MCP visual testing of both prototypes (screenshots in `.playwright-mcp/`)
- [x] Fix Shadcn History page crash (SelectItem empty value bug)
- [x] Shadcn: Implement client feature modals (Sampling, Elicitation, Roots) with mock data
- [x] Mantine: Port client feature modals (Sampling, Elicitation, Roots) for feature parity with Shadcn

---

**Note:** For major features, see GitHub issues with `v2` label. For session context, see `claude-progress.md`.
