# Inspector V2 - TODOs

## Waiting On

- [ ] **Conformance testing** - Needs coordination with Paul/Tobin before starting

## Pending

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

## In Progress (Spec Alignment)

### Session 3 - Modals
- [ ] ServerInfoModal
- [ ] AddServerModal (wire to ServerList dropdown)
- [ ] ImportServerJsonModal

### Session 4 - Mantine Port
- [ ] Port all spec alignment changes to v2/prototype/mantine

## Completed

- [x] Review specification docs in `inspector/specification/`
- [x] Scout V2-labeled issues for work items
- [x] Mantine vs Shadcn demo prototypes (v2/prototype/mantine, v2/prototype/shadcn)
- [x] Spec alignment Session 1 - Foundation (Dialog, Checkbox, Progress, ListChangedIndicator)
- [x] Spec alignment Session 1 - Logs 2-panel layout
- [x] Spec alignment Session 1 - Tasks card-based layout
- [x] Spec alignment Session 2 - Tools screen (annotations, progress, list changed)
- [x] Spec alignment Session 2 - Resources screen (annotations, templates, subscriptions)
- [x] Spec alignment Session 2 - History screen (cards, pin/unpin, expandable details)

---

**Note:** For major features, see GitHub issues with `v2` label. For session context, see `claude-progress.md`.
