# Inspector V2 UX - Visual Reference

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | V2 UX
#### [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | Screenshots | [Components](v2_ux_components.md)

---

This document provides visual screenshots from the **Shadcn UI prototype** (`v2/prototype/shadcn`). These complement the ASCII wireframes in the UX specification documents.

**Note:** The V2 implementation will use **Mantine** (see [V2 Tech Stack](v2_web_client.md#mantine-rationale)). These Shadcn screenshots remain as historical reference showing how the UX spec translates to a working UI. The Mantine implementation will have the same screens and functionality with slightly different visual styling.

## Table of Contents
  * [Server List](#server-list)
  * [Server Modals](#server-modals)
  * [Feature Screens](#feature-screens)
  * [Client Feature Handlers](#client-feature-handlers)

---

## Server List

The home screen showing server connection cards in a responsive grid.

![Server List](screenshots/shadcn-serverlist.png)

### Add Server Dropdown
Options for adding a new server (manual, import config, import server.json).

![Add Server Dropdown](screenshots/shadcn-addserver-dropdown.png)

---

## Server Modals

### Server Settings Modal
Per-server configuration including connection mode, headers, metadata, timeouts, and OAuth settings.

![Server Settings Modal](screenshots/shadcn-settings-modal.png)

### Server Info Modal
Displays server/client capabilities, protocol version, and server instructions.

![Server Info Modal](screenshots/shadcn-serverinfo-modal.png)

---

## Feature Screens

### Tools Screen
Tool list with annotations (user, read-only, destructive, long-running), parameter form, and results panel.

![Tools Screen](screenshots/shadcn-tools.png)

### Resources Screen
Accordion layout with Resources, Templates, and Subscriptions sections.

![Resources Screen](screenshots/shadcn-resources.png)

### Prompts Screen
Prompt selection, argument form with autocomplete, and message result display.

![Prompts Screen](screenshots/shadcn-prompts.png)

### Logging Screen
Real-time log stream with all 8 RFC 5424 log levels, color-coded by severity.

![Logging Screen](screenshots/shadcn-logs.png)

### Tasks Screen
Active and completed tasks with progress bars and status indicators.

![Tasks Screen](screenshots/shadcn-tasks.png)

### History Screen

Request history with replay and pin functionality.

![History Screen](screenshots/shadcn-history.png)

---

## Client Feature Handlers

### Sampling Panel
Handler for `sampling/createMessage` requests with mock response input.

![Sampling Panel](screenshots/shadcn-sampling-panel.png)

### Elicitation Form
Form-based handler for `elicitation/create` requests with JSON Schema-generated fields.

![Elicitation Form](screenshots/shadcn-elicitation-form.png)

### Roots Configuration
Configure filesystem roots exposed to the connected server.

![Roots Configuration](screenshots/shadcn-roots-config.png)

---

## Notes

- All screenshots are from the `v2/prototype/shadcn` branch (historical reference)
- The actual V2 implementation will use Mantine (`v2/prototype/mantine`)
- Dark theme is supported throughout the application (toggle in header)
- Screenshots may not reflect the latest implementation - refer to wireframes for authoritative UX
