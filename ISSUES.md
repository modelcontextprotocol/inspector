# Inspector V2 UI Issues

Issues to create in upstream repo (modelcontextprotocol/inspector) with `v2` label.

## Phase 1: Home Screen Experience

### UI-1: Fix ServerCard dropdown transparency bug
**Labels:** v2, bug
**Files:** `client/src/components/ServerCard.tsx`, `client/src/index.css`

The "Test Client Features" dropdown menu shows content behind it bleeding through. This is a z-index or Radix portal rendering issue.

**Tasks:**
- [ ] Fix z-index/portal issue with Radix dropdown
- [ ] Test on dark theme
- [ ] Verify all dropdown menus render correctly

---

### UI-2: Add Clone functionality to ServerCard
**Labels:** v2, enhancement
**Files:** `client/src/components/ServerCard.tsx`

Add ability to duplicate a server configuration for creating variants (different headers, OAuth settings, etc.).

**Tasks:**
- [ ] Add Clone button to card actions
- [ ] Clone duplicates server config with "(Copy)" suffix
- [ ] Cloned config opens in edit mode

**Spec Reference:** v2_ux.md - "Server Connection Card" - Clone section

---

### UI-3: Add error state display to ServerCard
**Labels:** v2, enhancement
**Files:** `client/src/components/ServerCard.tsx`

Display connection errors directly on the server card with retry count and troubleshooting links.

**Tasks:**
- [ ] Show error message on card when connection fails
- [ ] Display retry count (e.g., "Failed (3)")
- [ ] Add expandable error details with "Show more" toggle
- [ ] Add "View Troubleshooting Guide" link

**Spec Reference:** v2_ux.md - "Server Connection Card" - With Error State

---

### UI-4: Create ServerSettingsModal component
**Labels:** v2, enhancement
**Files:** `client/src/components/ServerSettingsModal.tsx` (NEW)

Per-server configuration modal for connection behavior, headers, metadata, timeouts, and OAuth credentials.

**Tasks:**
- [ ] Connection Mode dropdown (Direct / Via Proxy)
- [ ] Custom Headers key-value editor with add/remove
- [ ] Request Metadata key-value editor
- [ ] Timeouts inputs (Connection, Request in ms)
- [ ] OAuth Settings section:
  - Client ID input
  - Client Secret input (masked with show/hide)
  - Scopes input
- [ ] Save/Cancel actions with form validation

**Spec Reference:** v2_ux.md - "Server Settings Modal"

---

### UI-5: Integrate Settings button into ServerCard
**Labels:** v2, enhancement
**Files:** `client/src/components/ServerCard.tsx`

Add Settings action to server card that opens ServerSettingsModal.

**Tasks:**
- [ ] Add Settings button/icon to card actions
- [ ] Wire up to open ServerSettingsModal
- [ ] Pass current server config to modal

**Depends on:** UI-4

---

## Phase 2: OAuth Experience

### UI-6: Create OAuthDebuggerModal component
**Labels:** v2, enhancement
**Files:** `client/src/components/OAuthDebuggerModal.tsx` (NEW)

Step-by-step OAuth flow visualization for debugging authentication issues.

**Tasks:**
- [ ] Step 1: Authorization Request - Display URL with all parameters
- [ ] Step 2: Authorization Code - Show code received and state verification
- [ ] Step 3: Token Exchange - Show request/response
- [ ] Step 4: Access Token - Display token with expiration
- [ ] Refresh Token section with "Test Refresh Now" button
- [ ] JWT decode display (header and payload)
- [ ] Actions: Test Refresh, Revoke Token, Start New Flow, Copy

**Spec Reference:** v2_ux.md - "OAuth Debugger"

---

### UI-7: Add OAuth Debug button to ServerCard
**Labels:** v2, enhancement
**Files:** `client/src/components/ServerCard.tsx`

Show OAuth Debug button for servers using OAuth authentication.

**Tasks:**
- [ ] Conditionally show "OAuth Debug" button for OAuth-enabled servers
- [ ] Wire up to open OAuthDebuggerModal
- [ ] Pass OAuth state/tokens to modal

**Depends on:** UI-6

---

## Phase 3: History Screen Polish

### UI-8: Show SSE id in history
**Labels:** v2, enhancement
**Files:** `client/src/pages/History.tsx`
**Related Issue:** #934

Display SSE event `id` field in history entries for debugging reconnection behavior.

**Tasks:**
- [ ] Display SSE event `id` in history entry metadata
- [ ] Format as "SSE ID: {id}" if present
- [ ] Add to both collapsed and expanded views

---

### UI-9: Fix expand/collapse behavior in History
**Labels:** v2, bug
**Files:** `client/src/pages/History.tsx`
**Related Issue:** #928

Panels should fully collapse to minimal height when collapsed.

**Tasks:**
- [ ] Ensure panels fully collapse to minimal height
- [ ] Remove any minimum height constraints
- [ ] Consistent expand/collapse animation

---

### UI-10: Show progress tokens in history
**Labels:** v2, enhancement
**Files:** `client/src/pages/History.tsx`
**Related Issue:** #392

Display progressToken in request metadata and associated progress notifications.

**Tasks:**
- [ ] Display progressToken in request metadata
- [ ] Show progress updates associated with request
- [ ] Group progress notifications with their parent request

---

### UI-11: Add export and pagination to History
**Labels:** v2, enhancement
**Files:** `client/src/pages/History.tsx`

Add ability to export history and paginate large histories.

**Tasks:**
- [ ] Add "Export as JSON" button
- [ ] Export includes all visible/filtered entries
- [ ] Add "Load More" pagination for large histories
- [ ] Show "Showing X of Y entries" count

---

## Phase 4: Feature Screen Polish

### UI-12: Add autocomplete placeholder to Tools
**Labels:** v2, enhancement
**Files:** `client/src/pages/Tools.tsx`

Add UI for autocomplete suggestions in tool argument inputs.

**Tasks:**
- [ ] Add autocomplete UI for tool arguments
- [ ] Show "Suggestions: ..." below input fields
- [ ] Placeholder for completion/complete integration
- [ ] Support dropdown selection of suggestions

---

### UI-13: Verify accordion behavior in Resources
**Labels:** v2, bug
**Files:** `client/src/pages/Resources.tsx`

Ensure accordion sections work correctly per spec.

**Tasks:**
- [ ] Verify accordion expand/collapse works correctly
- [ ] Empty sections show "(0)" count and collapse by default
- [ ] If only Resources exist, that section expands by default
- [ ] Search filters across all sections simultaneously

---

### UI-14: Add autocomplete placeholder to Prompts
**Labels:** v2, enhancement
**Files:** `client/src/pages/Prompts.tsx`

Add UI for autocomplete suggestions in prompt argument inputs.

**Tasks:**
- [ ] Add autocomplete UI for prompt arguments
- [ ] Show "Suggestions: ..." below input fields
- [ ] Placeholder for completion/complete integration

---

## Phase 5: Logging and Tasks Polish

### UI-15: Add export functionality to Logs
**Labels:** v2, enhancement
**Files:** `client/src/pages/Logs.tsx`

Implement log export feature.

**Tasks:**
- [ ] Implement Export button
- [ ] Export as JSON with all metadata
- [ ] Alternative: Export as plain text with timestamps

---

### UI-16: Add clear history button to Tasks
**Labels:** v2, enhancement
**Files:** `client/src/pages/Tasks.tsx`

Add ability to clear completed task history.

**Tasks:**
- [ ] Add "Clear History" button for completed tasks section
- [ ] Confirmation dialog before clearing
- [ ] Keep active tasks, only clear completed

---

## Phase 6: Error Handling UX

### UI-17: Implement toast notification system
**Labels:** v2, enhancement
**Files:** `client/src/components/Toaster.tsx` (NEW), multiple integration points

Add centralized toast notification system for transient messages.

**Tasks:**
- [ ] Implement toast system (recommend Shadcn sonner)
- [ ] Success, error, warning, info variants
- [ ] Auto-dismiss after 5s with manual close option
- [ ] Stack multiple toasts
- [ ] Integrate at app root level

---

### UI-18: Add documentation links to error toasts
**Labels:** v2, enhancement
**Files:** Multiple components

Add contextual documentation links to error messages.

**Tasks:**
- [ ] Add "View Documentation" link on relevant errors
- [ ] Add "View Troubleshooting" link for connection errors
- [ ] Links open in new tab
- [ ] Map error types to documentation URLs

**Depends on:** UI-17

---

## Phase 7: Experimental Features

### UI-19: Create ExperimentalFeaturesPanel
**Labels:** v2, enhancement
**Files:** `client/src/components/ExperimentalFeaturesPanel.tsx` (NEW)

Advanced testing panel for experimental capabilities and raw JSON-RPC.

**Tasks:**
- [ ] Display server experimental capabilities from initialization
- [ ] Toggle client experimental capabilities to advertise
- [ ] Add custom client experimental capability
- [ ] Advanced JSON-RPC tester:
  - JSON editor with syntax highlighting for request
  - Custom headers key-value editor
  - Response display with copy
  - Request history with method, status, duration
  - "Load from History" dropdown
- [ ] Full control over _meta and progressToken fields

**Spec Reference:** v2_ux.md - "Experimental Features Panel"

---

## Backend Integration (Separate Track)

Backend integration issues will be created separately once proxy server work begins.
These will be prefixed with `BE-` and link to corresponding `UI-` issues.

Examples:
- BE-1: Wire ServerCard connection to proxy
- BE-2: Implement mcp.json config CRUD
- BE-3: Wire OAuth flow to actual endpoints
