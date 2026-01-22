# TUI and Web Client Feature Gap Analysis

## Overview

This document details the feature gaps between the TUI (Terminal User Interface) and the web client. The goal is to identify all missing features in the TUI and create a plan to close these gaps by extending `InspectorClient` and implementing the features in the TUI.

## Feature Comparison Matrix

| Feature                           | Web Client | TUI | Gap Priority      |
| --------------------------------- | ---------- | --- | ----------------- |
| **Resources**                     |
| List resources                    | ✅         | ✅  | -                 |
| Read resource content             | ✅         | ✅  | -                 |
| List resource templates           | ✅         | ✅  | -                 |
| Read templated resources          | ✅         | ✅  | -                 |
| Resource subscriptions            | ✅         | ❌  | Medium            |
| **Prompts**                       |
| List prompts                      | ✅         | ✅  | -                 |
| Get prompt (no params)            | ✅         | ✅  | -                 |
| Get prompt (with params)          | ✅         | ✅  | -                 |
| **Tools**                         |
| List tools                        | ✅         | ✅  | -                 |
| Call tool                         | ✅         | ✅  | -                 |
| **Authentication**                |
| OAuth 2.1 flow                    | ✅         | ❌  | High              |
| Custom headers                    | ✅         | ❌  | Medium            |
| **Advanced Features**             |
| Sampling requests                 | ✅         | ❌  | High              |
| Elicitation requests              | ✅         | ❌  | High              |
| Completions (resource templates)  | ✅         | ❌  | Medium            |
| Completions (prompts with params) | ✅         | ❌  | Medium            |
| **Other**                         |
| HTTP request tracking             | ❌         | ✅  | - (TUI advantage) |

## Detailed Feature Gaps

### 1. Reading and Displaying Resource Content

**Web Client Support:**

- Calls `resources/read` method to fetch actual resource content
- `resources/read` returns `{ contents: [{ uri, mimeType, text, ... }] }` - the actual resource content (file text, data, etc.)
- Displays resource content in `JsonView` component
- Has "Refresh" button to re-read resource content
- Stores read content in `resourceContent` state and `resourceContentMap` for caching

**TUI Status:**

- ✅ **Calls `readResource()`** when Enter is pressed on a resource
- ✅ **Displays resource content** in the details pane as JSON
- ✅ Shows "[Enter to Fetch Resource]" prompt in details pane
- ✅ Fetches and displays actual resource contents

**Implementation:**

- Press Enter on a resource to call `inspectorClient.readResource(uri)`
- Resource content is displayed in the details pane as JSON
- Content is fetched on-demand when Enter is pressed
- Loading state is shown while fetching

**Code References:**

- TUI: `tui/src/components/ResourcesTab.tsx` (lines 158-180) - `readResource()` call and content display
- TUI: `tui/src/components/ResourcesTab.tsx` (lines 360, 423) - "[Enter to Fetch Resource]" prompts
- `InspectorClient`: Has `readResource()` method (line 535-554)

**Note:** ✅ **COMPLETED** - TUI can now fetch and display resource contents.

### 2. Resource Templates

**Web Client Support:**

- Lists resource templates via `resources/templates/list`
- Displays templates with URI template patterns (e.g., `file://{path}`)
- Provides form UI for filling template variables
- Uses URI template expansion (`UriTemplate.expand()`) to generate final URIs
- Supports completion requests for template variable values
- Reads resources from expanded template URIs

**TUI Status:**

- ✅ Support for listing resource templates (displayed in ResourcesTab)
- ✅ Support for reading templated resources via modal form
- ✅ URI template expansion using `UriTemplate.expand()`
- ✅ Template variable input UI via `ResourceTestModal`
- ❌ Completion support for template variable values (still needed)

**Implementation:**

- Resource templates are listed in ResourcesTab alongside regular resources
- Press Enter on a template to open `ResourceTestModal`
- Modal form collects template variable values
- Expanded URI is used to read the resource
- Resource content is displayed in the modal results

**Code References:**

- TUI: `tui/src/components/ResourcesTab.tsx` (lines 249-275) - Template listing and selection
- TUI: `tui/src/components/ResourceTestModal.tsx` - Template form and resource reading
- TUI: `tui/src/utils/uriTemplateToForm.ts` - Converts URI template to form structure
- `InspectorClient`: Has `listResourceTemplates()` and `readResource()` methods

**Note:** ✅ **COMPLETED** - TUI can now list and read templated resources. Completion support for template variables is still needed.

### 3. Resource Subscriptions

**Web Client Support:**

- Subscribes to resources via `resources/subscribe`
- Unsubscribes via `resources/unsubscribe`
- Tracks subscribed resources in state
- UI shows subscription status and subscribe/unsubscribe buttons
- Handles `notifications/resources/updated` notifications for subscribed resources

**TUI Status:**

- ❌ No support for resource subscriptions
- ❌ No subscription state management
- ❌ No UI for subscribe/unsubscribe actions

**Implementation Requirements:**

- Add `subscribeResource(uri)` and `unsubscribeResource(uri)` methods to `InspectorClient`
- Add subscription state tracking in `InspectorClient`
- Add UI in TUI `ResourcesTab` for subscribe/unsubscribe actions
- Handle resource update notifications for subscribed resources

**Code References:**

- Web client: `client/src/App.tsx` (lines 781-809)
- Web client: `client/src/components/ResourcesTab.tsx` (lines 207-221)

### 4. OAuth 2.1 Authentication

**Web Client Support:**

- Full browser-based OAuth 2.1 flow:
  - Dynamic Client Registration (DCR)
  - Authorization code flow with PKCE
  - Token exchange
  - Token refresh
- OAuth state management via `InspectorOAuthClientProvider`
- Session storage for OAuth tokens
- OAuth callback handling
- Automatic token injection into request headers

**TUI Status:**

- ❌ No OAuth support
- ❌ No OAuth token management

**Implementation Requirements:**

- Browser-based OAuth flow with localhost callback server (TUI-specific approach)
- OAuth token management in `InspectorClient`
- Token injection into transport headers
- OAuth configuration in TUI server config

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (lines 449-480)
- Web client: `client/src/lib/auth.ts`
- Architecture doc mentions: "There is a plan for implementing OAuth from the TUI"

**Note:** OAuth in TUI requires a browser-based flow with a localhost callback server, which is feasible but different from the web client's approach.

### 5. Sampling Requests

**Web Client Support:**

- Declares `sampling: {}` capability in client initialization
- Sets up request handler for `sampling/createMessage` requests
- UI tab (`SamplingTab`) displays pending sampling requests
- `SamplingRequest` component shows request details and approval UI
- Handles approve/reject actions
- Tracks pending requests in state

**TUI Status:**

- ❌ No sampling support
- ❌ No sampling request handler
- ❌ No UI for sampling requests

**Implementation Requirements:**

- Add sampling capability declaration to `InspectorClient` client initialization
- Add `setSamplingHandler()` method to `InspectorClient` (or use `getClient().setRequestHandler()`)
- Add UI in TUI for displaying and handling sampling requests
- Add sampling tab or integrate into existing tabs

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (line 420)
- Web client: `client/src/components/SamplingTab.tsx`
- Web client: `client/src/components/SamplingRequest.tsx`
- Web client: `client/src/App.tsx` (lines 328-333, 637-652)

### 6. Elicitation Requests

**Web Client Support:**

- Declares `elicitation: {}` capability in client initialization
- Sets up request handler for `elicitation/create` requests
- UI tab (`ElicitationTab`) displays pending elicitation requests
- `ElicitationRequest` component:
  - Shows request message and schema
  - Generates dynamic form from JSON schema
  - Validates form data against schema
  - Handles accept/decline/cancel actions
- Tracks pending requests in state

**TUI Status:**

- ❌ No elicitation support
- ❌ No elicitation request handler
- ❌ No UI for elicitation requests

**Implementation Requirements:**

- Add elicitation capability declaration to `InspectorClient` client initialization
- Add `setElicitationHandler()` method to `InspectorClient` (or use `getClient().setRequestHandler()`)
- Add UI in TUI for displaying and handling elicitation requests
- Add form generation from JSON schema (similar to tool parameter forms)
- Add elicitation tab or integrate into existing tabs

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (line 421, 810-813)
- Web client: `client/src/components/ElicitationTab.tsx`
- Web client: `client/src/components/ElicitationRequest.tsx`
- Web client: `client/src/App.tsx` (lines 334-356, 653-669)
- Web client: `client/src/utils/schemaUtils.ts` (schema resolution for elicitation)

### 7. Completions

**Web Client Support:**

- Detects completion capability via `serverCapabilities.completions`
- `handleCompletion()` function sends `completion/complete` requests
- Used in resource template forms for autocomplete
- Used in prompt forms with parameters for autocomplete
- `useCompletionState` hook manages completion state
- Completion requests include:
  - `ref`: Resource or prompt reference
  - `argument`: Field name and current value
  - `context`: Additional context (template values or prompt argument values)

**TUI Status:**

- ✅ Prompt fetching with parameters - **COMPLETED** (modal form for collecting prompt arguments)
- ❌ No completion support for resource template forms
- ❌ No completion support for prompt parameter forms
- ❌ No completion capability detection
- ❌ No completion request handling

**Implementation Requirements:**

- Add completion capability detection (already available via `getCapabilities()?.completions`)
- Add `handleCompletion()` method to `InspectorClient` (or document access via `getClient()`)
- Integrate completion support into TUI forms:
  - **Resource template forms** - autocomplete for template variable values
  - **Prompt parameter forms** - autocomplete for prompt argument values
- Add completion state management

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (lines 309, 384-386)
- Web client: `client/src/lib/hooks/useCompletionState.ts`
- Web client: `client/src/components/ResourcesTab.tsx` (lines 88-101)
- TUI: `tui/src/components/PromptTestModal.tsx` - Prompt form (needs completion integration)
- TUI: `tui/src/components/ResourceTestModal.tsx` - Resource template form (needs completion integration)

### 8. Custom Headers

**Web Client Support:**

- Custom header management (migration from legacy auth)
- Header validation
- OAuth token injection into headers
- Special header processing (`x-custom-auth-headers`)
- Headers passed to transport creation

**TUI Status:**

- ❌ No custom header support
- ❌ No header configuration UI

**Implementation Requirements:**

- Add `headers` support to `MCPServerConfig` (already exists for SSE and StreamableHTTP)
- Add header configuration in TUI server config
- Pass headers to transport creation (already supported in `createTransport()`)

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (lines 447-480)
- `InspectorClient`: Headers already supported in `MCPServerConfig` types

## Implementation Priority

### Critical Priority (Core Functionality)

1. ✅ **Read Resource Content** - **COMPLETED** - TUI can now fetch and display resource contents
2. ✅ **Resource Templates** - **COMPLETED** - TUI can list and read templated resources

### High Priority (Core MCP Features)

3. **OAuth** - Required for many MCP servers, critical for production use
4. **Sampling** - Core MCP capability, enables LLM sampling workflows
5. **Elicitation** - Core MCP capability, enables interactive workflows

### Medium Priority (Enhanced Features)

6. **Resource Subscriptions** - Useful for real-time resource updates
7. **Completions** - Enhances UX for form filling
8. **Custom Headers** - Useful for custom authentication schemes

## Implementation Strategy

### Phase 0: Critical Resource Reading (Immediate)

1. ✅ **Implement resource content reading and display** - **COMPLETED** - Added ability to call `readResource()` and display content
2. ✅ **Resource templates** - **COMPLETED** - Added listing and reading templated resources with form UI

### Phase 1: Core Resource Features

1. ✅ **Resource templates** - **COMPLETED** (listing, reading templated resources with form UI)
2. ✅ **Prompt fetching with parameters** - **COMPLETED** (modal form for collecting prompt arguments)
3. Add resource subscriptions support

### Phase 2: Authentication

1. Implement OAuth flow for TUI (browser-based with localhost callback)
2. Add custom headers support

### Phase 3: Advanced MCP Features

1. Implement sampling request handling
2. Implement elicitation request handling
3. Add completion support for resource template forms
4. Add completion support for prompt parameter forms

## InspectorClient Extensions Needed

Based on this analysis, `InspectorClient` needs the following additions:

1. **Resource Methods** (some already exist):
   - ✅ `readResource(uri, metadata?)` - Already exists
   - ✅ `listResourceTemplates()` - Already exists
   - ❌ `subscribeResource(uri)` - Needs to be added
   - ❌ `unsubscribeResource(uri)` - Needs to be added

2. **Request Handlers**:
   - ❌ `setSamplingHandler(handler)` - Or document using `getClient().setRequestHandler()`
   - ❌ `setElicitationHandler(handler)` - Or document using `getClient().setRequestHandler()`
   - ❌ `setPendingRequestHandler(handler)` - Or document using `getClient().setRequestHandler()`

3. **Completion Support**:
   - ❌ `handleCompletion(ref, argument, context?)` - Needs to be added or documented
   - ❌ Integration into `ResourceTestModal` for template variable completion
   - ❌ Integration into `PromptTestModal` for prompt argument completion

4. **OAuth Support**:
   - ❌ OAuth token management
   - ❌ OAuth flow initiation
   - ❌ Token injection into headers

5. **Client Capabilities**:
   - ❌ Declare `sampling: {}` capability in client initialization
   - ❌ Declare `elicitation: {}` capability in client initialization
   - ❌ Declare `roots: { listChanged: true }` capability in client initialization

## Notes

- **HTTP Request Tracking**: TUI has this feature, web client does not. This is a TUI advantage, not a gap.
- **Resource Subscriptions**: Web client supports this, but TUI does not. This is a gap to address.
- **OAuth**: Web client has full OAuth support. TUI needs browser-based OAuth flow with localhost callback server.
- **Completions**: Web client uses completions for resource template forms and prompt parameter forms. TUI now has both resource template forms and prompt parameter forms, but completion support is still needed to provide autocomplete suggestions.
- **Prompt Fetching**: TUI now supports fetching prompts with parameters via a modal form, matching web client functionality.

## Related Documentation

- [Shared Code Architecture](./shared-code-architecture.md) - Overall architecture and integration plan
- [InspectorClient Details](./inspector-client-details.svg) - Visual diagram of InspectorClient responsibilities

## In Work

### Sampling

Instead of a boolean, we could use a callback that accepts the params from a sampling message and returns the response to a sampling message (if the callback is present, advertise sampling and also handle sampling/createMessage messages using the callback). Maybe?

The webux shows a dialog (in a pane) for the user to completed and approve/reject the completion. We should copy that.

But it would also be nice to have this supported in the InspectorClient somehow

- For exmple, we could have a test fixture tool that triggered sampling
- And a sampling function that returned some result (via provided callback)
- Then we could test the sampling support in the InspectorClient (call tool, check result to make sure it includes expected sampling data)

Could a callback provided to the InspectorClient trigger a UX action (modal or other) and then on completion could we complete the sampling request?

- Would we need to have a separate sampling completion entrypoint?
