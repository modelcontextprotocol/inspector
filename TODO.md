# Inspector V2 - TODOs

## Waiting On

- [ ] **Conformance testing** - Needs coordination with Paul/Tobin before starting

## Bugs

- [ ] **[Shadcn] Dropdown menu transparent background** - "Test Client Features" dropdown shows content behind it. Added --popover CSS variables but issue persists. May be z-index or Radix portal issue.

## Pending

- [ ] Mantine: Port client feature modals (Sampling, Elicitation, Roots) for feature parity with Shadcn
- [ ] Decide Mantine vs Shadcn after UI review (see build sizes in claude-progress.md)
- [ ] Shadcn Badge needs `success`/`error` variant styling (currently unstyled)
- [ ] Test dark mode on both prototypes
- [ ] Prototype reference auth servers (covers OAuth, API key, etc.)

## Ready to Implement (Specs in v2_ux.md)

- [ ] Server list UI - see "Server List (Home)"
- [ ] Server config CRUD - see "Server Connection Card", "Import server.json Modal"
- [ ] Connection flow with mcp.json - see "Server Connection Card"
- [ ] Server info screen - see "Server Info (Connected)"
- [ ] Centralized error handling - see "Error Handling UX"
- [ ] Feature screens (Tools, Resources, Prompts, etc.) - see "Feature Screens"

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

---

**Note:** For major features, see GitHub issues with `v2` label. For session context, see `claude-progress.md`.
