# MCP Inspector: Pane Hierarchy Documentation

This document defines the standardized layout structure for the MCP Inspector. All resizing logic and overflow boundaries must adhere to this hierarchy.

## Level 1: Root Layout

- **Container**: `flex h-screen w-screen overflow-hidden`
- **Axis**: Horizontal (Flex Row)
- **Pane A**: **Connection Pane** (Left Sidebar)
  - Content: Connection settings, transport selection, configuration.
  - Size: Percentage-based width.
- **Pane B**: **Working Area Container**
  - Content: Flexible container holding the Main Pane and Notification Pane.
  - Size: `flex-1`.
- **Resizer**: Controls the width boundary between Connection Pane and Working Area.

## Level 2: Working Area (Inside Level 1, Pane B)

- **Container**: `flex-1 flex flex-col min-h-0`
- **Axis**: Vertical (Flex Column)
- **Pane A**: **Main Pane**
  - Content: Standard Tab navigation (Resources, Prompts, Tools, Tasks, etc.).
  - Size: `flex-1`.
- **Pane B**: **Notification Pane** (History Drawer)
  - Content: Contains the History and Server Notifications sub-panes.
  - Size: Percentage-based height.
- **Resizer**: Controls the height boundary between Main Pane and Notification Pane.

## Level 3a: Main Pane Content (Inside Level 2, Pane A - Tools Tab)

- **Container**: `flex h-full w-full overflow-hidden`
- **Axis**: Horizontal (Flex Row)
- **Pane A**: **Tools List**
  - Content: Scrollable list of available tools.
  - Size: Percentage-based width.
- **Pane B**: **Tool Details**
  - Content: Tool description, input form, and execution results.
  - Size: `flex-1`.
- **Resizer**: Controls the width boundary between Tools List and Tool Details.

## Level 3b: Notification Pane Content (Inside Level 2, Pane B)

- **Container**: `flex h-full w-full overflow-hidden`
- **Axis**: Horizontal (Flex Row)
- **Pane A**: **History**
  - Content: List of sent MCP requests and received responses.
  - Size: `flex-1`.
- **Pane B**: **Server Notifications**
  - Content: Real-time stream of server-sent notifications.
  - Size: Percentage-based width.
- **Resizer**: Controls the width boundary between History and Server Notifications.

---

## Architectural Rules

1.  **Clipping**: Every `Pane` component must strictly enforce `overflow-hidden` to provide a clear boundary.
2.  **Resizers**: The `SplitResizer` must sit _between_ two panes (physically or as an absolute overlay) and update the size of the target pane without being clipped by it.
3.  **Proportions**: All sizes must be percentage-based to ensure proportional scaling when the browser window is resized.
