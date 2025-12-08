# Inspector V2 - TODOs

## Current Focus

Testing Shadcn prototype first - all 18 UI issues (UI-2 to UI-19) implemented on `v2/prototype/shadcn`.
Mantine port deferred until after Shadcn testing/validation.

## UI Work Items Status

See **[ISSUES.md](ISSUES.md)** for detailed breakdown.

| Phase | Description | Shadcn | Mantine |
|-------|-------------|--------|---------|
| 1 | Home Screen Experience (UI-1 to UI-5) | DONE (UI-1 wontfix) | Not started |
| 2 | OAuth Experience (UI-6 to UI-7) | DONE | Not started |
| 3 | History Screen Polish (UI-8 to UI-11) | DONE | Not started |
| 4 | Feature Screen Polish (UI-12 to UI-14) | DONE | Not started |
| 5 | Logging and Tasks Polish (UI-15 to UI-16) | DONE | Not started |
| 6 | Error Handling UX (UI-17 to UI-18) | DONE | Not started |
| 7 | Experimental Features (UI-19) | DONE | Not started |

## Next Steps

- [ ] **Visual testing** - Run dev server and test all new features in browser
- [ ] **Playwright MCP testing** - Capture screenshots of new components/pages
- [ ] **Decide on Mantine port** - Based on Shadcn testing results, decide if Mantine needs the same features

## Waiting On

- [ ] **Conformance testing** - Needs coordination with Paul/Tobin before starting

## Bugs

- [x] **[Shadcn] Dropdown menu transparent background** - Marked wontfix (UI-1)

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
- [x] **Shadcn: UI-2 to UI-19 implementation** (2025-12-08)
  - ServerSettingsModal, OAuthDebuggerModal, ExperimentalFeaturesPanel
  - Toast system with sonner + doc links
  - History enhancements (SSE id, progress tokens, export, pagination)
  - Clone, error display, Settings/OAuth Debug buttons on ServerCard
  - Export/clear for Logs and Tasks

---

**Note:** For major features, see GitHub issues with `v2` label. For session context, see `claude-progress.md`.
