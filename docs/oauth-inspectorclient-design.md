# OAuth Support in InspectorClient - Design and Implementation Plan

## Overview

This document outlines the design and implementation plan for adding MCP OAuth 2.1 support to `InspectorClient`. The goal is to extract the general-purpose OAuth logic from the web client into the shared package and integrate it into `InspectorClient`, making OAuth available for CLI, TUI, and other InspectorClient consumers.

**Important**: The web client OAuth code will remain in place and will not be modified to use the shared code at this time. Future migration options (using shared code directly, relying on InspectorClient, or a combination) should be considered in the design but not implemented.

## Goals

1. **Extract General-Purpose OAuth Logic**: Copy reusable OAuth components from `client/src/lib/` and `client/src/utils/` to `shared/auth/` (leaving originals in place)
2. **Abstract Platform Dependencies**: Create interfaces for storage, navigation, and redirect URLs to support both browser and Node.js environments
3. **Integrate with InspectorClient**: Add OAuth support to `InspectorClient` with both direct and indirect (401-triggered) OAuth flow initiation
4. **Support All Client Identification Modes**: Support static/preregistered clients, DCR (Dynamic Client Registration), and CIMD (Client ID Metadata Documents)
5. **Enable CLI/TUI OAuth**: Provide a foundation for OAuth support in CLI and TUI applications
6. **Event-Driven Architecture**: Design OAuth flow to be notification/callback driven for client-side integration

## Architecture

### Current State

The web client's OAuth implementation consists of:

- **OAuth Client Providers** (`client/src/lib/auth.ts`):
  - `InspectorOAuthClientProvider`: Standard OAuth provider for automatic flow
  - `GuidedInspectorOAuthClientProvider`: Extended provider for guided flow that saves server metadata and uses guided redirect URL
- **OAuth State Machine** (`client/src/lib/oauth-state-machine.ts`): Step-by-step OAuth flow that breaks OAuth into discrete, manually-progressible steps
- **OAuth Utilities** (`client/src/utils/oauthUtils.ts`): Pure functions for parsing callbacks and generating state
- **Scope Discovery** (`client/src/lib/auth.ts`): `discoverScopes()` function
- **Storage Functions** (`client/src/lib/auth.ts`): SessionStorage-based storage helpers
- **UI Components**:
  - `AuthDebugger.tsx`: Core OAuth UI providing both "Guided" (step-by-step) and "Quick" (automatic) flows
  - `OAuthFlowProgress.tsx`: Visual progress indicator showing OAuth step status
  - OAuth callback handlers (web-specific, not moving)

**Note on "Guided" Mode**: The Auth Debugger (guided mode) is a **core feature** of the web client, not an optional debug tool. It provides:

- **Guided Flow**: Manual step-by-step progression with full state visibility
- **Quick Flow**: Automatic progression through all steps
- **State Inspection**: Full visibility into OAuth state (tokens, metadata, client info, etc.)
- **Error Debugging**: Clear error messages and validation at each step

This guided mode should be considered a core requirement for InspectorClient OAuth support, not a future enhancement.

### Target Architecture

```
shared/auth/
├── storage.ts              # Storage abstraction using Zustand with persistence
├── providers.ts            # Abstract OAuth client provider base class
├── state-machine.ts        # OAuth state machine (general-purpose logic)
├── utils.ts                # General-purpose utilities
├── types.ts                # OAuth-related types
├── discovery.ts            # Scope discovery utilities
├── store.ts                # Zustand store for OAuth state (vanilla, no React deps)
└── __tests__/              # Tests

shared/mcp/
└── inspectorClient.ts      # InspectorClient with OAuth integration

shared/react/
└── auth/                   # Optional: Shareable React hooks for OAuth state
    └── hooks.ts            # React hooks (useOAuthStore, etc.) - requires React peer dep
                            # Note: UI components cannot be shared between TUI (Ink) and web (DOM)
                            # Each client must implement its own OAuth UI components

client/src/lib/             # Web client OAuth code (unchanged)
├── auth.ts
└── oauth-state-machine.ts
```

## Abstraction Strategy

### 1. Storage Abstraction with Zustand

**Storage Strategy**: Use Zustand with persistent middleware for OAuth state management. Zustand's vanilla API allows non-React usage (CLI), while React bindings enable UI integration (TUI, web client).

**Zustand Store Structure**:

```typescript
interface OAuthStoreState {
  // Server-scoped OAuth data
  servers: Record<
    string,
    {
      tokens?: OAuthTokens;
      clientInformation?: OAuthClientInformation;
      preregisteredClientInformation?: OAuthClientInformation;
      codeVerifier?: string;
      scope?: string;
      serverMetadata?: OAuthMetadata;
    }
  >;

  // Actions
  setTokens: (serverUrl: string, tokens: OAuthTokens) => void;
  getTokens: (serverUrl: string) => OAuthTokens | undefined;
  clearServer: (serverUrl: string) => void;
  // ... other actions
}
```

**Storage Implementations**:

- **Browser**: Zustand store with `persist` middleware using `sessionStorage` adapter
- **Node.js**: Zustand store with `persist` middleware using file-based storage adapter
- **Memory**: Zustand store without persistence (for testing)

**Storage Location for InspectorClient**:

- Default: `~/.mcp-inspector/oauth/state.json` (single Zustand store file)
- Configurable via `InspectorClientOptions.oauth?.storagePath`

**Benefits of Zustand**:

- Vanilla API works without React (CLI support)
- React hooks available for UI components (TUI, web client)
- Built-in persistence middleware
- Type-safe state management
- Easier to backup/restore (one file)
- Small bundle size

### 2. Redirect URL Abstraction

**Interface**:

```typescript
interface RedirectUrlProvider {
  /**
   * Returns the redirect URL for normal mode
   */
  getRedirectUrl(): string;

  /**
   * Returns the redirect URL for guided mode
   */
  getDebugRedirectUrl(): string;
}
```

**Implementations**:

- `BrowserRedirectUrlProvider`:
  - Normal: `window.location.origin + "/oauth/callback"`
  - Guided: `window.location.origin + "/oauth/callback/guided"`
- `LocalServerRedirectUrlProvider`:
  - Constructor takes `port: number` parameter
  - Normal: `http://localhost:${port}/oauth/callback`
  - Guided: `http://localhost:${port}/oauth/callback/guided`
- `ManualRedirectUrlProvider`:
  - Constructor takes `baseUrl: string` parameter
  - Normal: `${baseUrl}/oauth/callback`
  - Guided: `${baseUrl}/oauth/callback/guided`

**Design Rationale**:

- Both redirect URLs are available from the provider
- Both URLs are registered with the OAuth server during client registration (like web client)
- This allows switching between normal and guided modes without re-registering the client
- The provider's mode determines which URL is used for the current flow, but both are registered for flexibility

### 3. Navigation Abstraction

**Interface**:

```typescript
interface OAuthNavigation {
  redirectToAuthorization(url: URL): void | Promise<void>;
}
```

**Implementations**:

- `BrowserNavigation`: Sets `window.location.href` (for web client)
- `ConsoleNavigation`: Prints URL to console and waits for callback (for CLI/TUI)
- `CallbackNavigation`: Calls a provided callback function (for InspectorClient)

### 4. OAuth Client Provider Abstraction

**Base Class**:

```typescript
abstract class BaseOAuthClientProvider implements OAuthClientProvider {
  constructor(
    protected serverUrl: string,
    protected storage: OAuthStorage,
    protected redirectUrlProvider: RedirectUrlProvider,
    protected navigation: OAuthNavigation,
    protected mode: "normal" | "guided" = "normal", // OAuth flow mode
  ) {}

  // Abstract methods implemented by subclasses
  abstract get scope(): string | undefined;

  // Returns the redirect URL for the current mode
  get redirectUrl(): string {
    return this.mode === "guided"
      ? this.redirectUrlProvider.getDebugRedirectUrl()
      : this.redirectUrlProvider.getRedirectUrl();
  }

  // Returns both redirect URIs (registered with OAuth server for flexibility)
  get redirect_uris(): string[] {
    return [
      this.redirectUrlProvider.getRedirectUrl(),
      this.redirectUrlProvider.getDebugRedirectUrl(),
    ];
  }

  abstract get clientMetadata(): OAuthClientMetadata;

  // Shared implementation for SDK interface methods
  async clientInformation(): Promise<OAuthClientInformation | undefined> { ... }
  saveClientInformation(clientInformation: OAuthClientInformation): void { ... }
  async tokens(): Promise<OAuthTokens | undefined> { ... }
  saveTokens(tokens: OAuthTokens): void { ... }
  saveCodeVerifier(codeVerifier: string): void { ... }
  codeVerifier(): string { ... }
  clear(): void { ... }
  redirectToAuthorization(authorizationUrl: URL): void { ... }
  state(): string | Promise<string> { ... }
}
```

**Implementations**:

- `BrowserOAuthClientProvider`: Extends base, uses browser storage and navigation (for web client)
- `NodeOAuthClientProvider`: Extends base, uses Zustand store and console navigation (for InspectorClient/CLI/TUI)

**Mode Selection**:

- **Normal mode** (`mode: "normal"`): Provider uses `/oauth/callback` for the current flow
- **Guided mode** (`mode: "guided"`): Provider uses `/oauth/callback/guided` for the current flow
- Both URLs are registered with the OAuth server during client registration (allows switching modes without re-registering)
- The mode is determined when creating the provider - specify normal or debug and it "just works"
- Both callback handlers are mounted (one at `/oauth/callback`, one at `/oauth/callback/guided`)
- The handler behavior matches the provider's mode (normal handler auto-completes, debug handler shows code)

**Client Identification Modes**:

- **Static/Preregistered**: Uses `clientId` and optional `clientSecret` from config
- **DCR (Dynamic Client Registration)**: Falls back to DCR if no static client provided
- **CIMD (Client ID Metadata Documents)**: Uses `clientMetadataUrl` from config to enable URL-based client IDs (SEP-991)

## Module Structure

### `shared/auth/store.ts`

**Exports** (vanilla-only, no React dependencies):

- `createOAuthStore()` - Factory function to create Zustand store
- `getOAuthStore()` - Vanilla API for accessing store (no React dependency)

**Note**: React hooks (if needed) would be in `shared/react/auth/hooks.ts` as an optional export that requires React as a peer dependency.

**Store Implementation**:

- Uses Zustand's `create` function with `persist` middleware
- Browser: Persists to `sessionStorage` via Zustand's `persist` middleware
- Node.js: Persists to file via custom storage adapter for Zustand's `persist` middleware
- Memory: No persistence (for testing)

**Storage Adapter for Node.js**:

- Custom Zustand storage adapter that uses Node.js `fs/promises`
- Stores single JSON file: `~/.mcp-inspector/oauth/state.json`
- Handles file creation, reading, and writing atomically

### `shared/auth/providers.ts`

**Exports**:

- `BaseOAuthClientProvider` abstract class
- `BrowserOAuthClientProvider` class (for web client, uses sessionStorage directly)
- `NodeOAuthClientProvider` class (for InspectorClient/CLI/TUI, uses Zustand store)

**Key Methods**:

- All SDK `OAuthClientProvider` interface methods
- Server-specific state management via Zustand store
- Token and client information management
- Support for `clientMetadataUrl` for CIMD mode

### `shared/auth/state-machine.ts`

**Exports**:

- `OAuthStateMachine` class
- `oauthTransitions` object (state transition definitions)
- `StateMachineContext` interface
- `StateTransition` interface

**Changes from Current Implementation**:

- Accepts abstract `OAuthClientProvider` instead of `DebugInspectorOAuthClientProvider`
- Removes web-specific dependencies (sessionStorage, window.location)
- General-purpose state transition logic

### `shared/auth/utils.ts`

**Exports**:

- `parseOAuthCallbackParams(location: string): CallbackParams` - Pure function
- `generateOAuthErrorDescription(params: CallbackParams): string` - Pure function
- `generateOAuthState(): string` - Uses `globalThis.crypto` or Node.js `crypto` module

**Changes from Current Implementation**:

- `generateOAuthState()` checks for `globalThis.crypto` first (browser), falls back to Node.js `crypto.randomBytes()`

### `shared/auth/types.ts`

**Exports**:

- `CallbackParams` type (from `oauthUtils.ts`)
- Re-export SDK OAuth types as needed

### `shared/auth/discovery.ts`

**Exports**:

- `discoverScopes(serverUrl: string, resourceMetadata?: OAuthProtectedResourceMetadata): Promise<string | undefined>`

**Note**: This is already general-purpose (uses only SDK functions), just needs to be moved.

### `shared/react/auth/` (Optional - Shareable React Hooks Only)

**What Can Be Shared**:

- `hooks.ts` - React hooks for accessing OAuth state:
  - `useOAuthStore()` - Hook to access Zustand OAuth store
  - `useOAuthTokens()` - Hook to get current OAuth tokens
  - `useOAuthState()` - Hook to get current OAuth state machine state
  - These hooks are pure logic - no rendering, so they work with both Ink (TUI) and DOM (web)

**What Cannot Be Shared**:

- **UI Components** (`.tsx` files with visual rendering) cannot be shared because:
  - TUI uses **Ink** (terminal rendering) with components like `<Box>`, `<Text>`, etc.
  - Web client uses **DOM** (browser rendering) with components like `<div>`, `<span>`, etc.
  - They have completely different rendering targets, styling systems, and component APIs
- Each client must implement its own OAuth UI components:
  - TUI: `tui/src/components/OAuthFlowProgress.tsx` (using Ink components)
  - Web: `client/src/components/OAuthFlowProgress.tsx` (using DOM/HTML components)

## OAuth Guided Mode (Core Feature)

### What is the Auth Debugger?

The "Auth Debugger" (guided mode) in the web client is **not** an optional debug tool - it's a **core feature** that provides two modes of OAuth flow:

1. **Guided Flow** (Step-by-Step):
   - Breaks OAuth into discrete, manually-progressible steps
   - User clicks "Next" to advance through each step
   - Full state visibility at each step (metadata, client info, tokens, etc.)
   - Allows inspection and debugging of OAuth flow
   - Steps: `metadata_discovery` → `client_registration` → `authorization_redirect` → `authorization_code` → `token_request` → `complete`

2. **Quick Flow** (Automatic):
   - Automatically progresses through all OAuth steps
   - Still uses the state machine internally
   - Redirects to authorization URL automatically
   - Returns to callback with authorization code

### How It Works

**Components**:

- **`OAuthStateMachine`**: Manages step-by-step progression through OAuth flow
- **`GuidedInspectorOAuthClientProvider`** (shared: `GuidedNodeOAuthClientProvider`): Extended provider that:
  - Uses guided redirect URL (`/oauth/callback/guided` instead of `/oauth/callback`)
  - Saves server OAuth metadata to storage for UI display
  - Provides `getServerMetadata()` and `saveServerMetadata()` methods
- **`AuthGuidedState`**: Comprehensive state object tracking all OAuth data:
  - Current step (`oauthStep`)
  - OAuth metadata, client info, tokens
  - Authorization URL, code, errors
  - Resource metadata, validation errors

**State Machine Steps** (Detailed):

1. **`metadata_discovery`**: **RFC 8414 Discovery** - Client discovers authorization server metadata
   - Always client-initiated (never uses server-provided metadata from MCP capabilities)
   - Calls SDK `discoverOAuthProtectedResourceMetadata()` which makes HTTP request to `/.well-known/oauth-protected-resource`
   - Calls SDK `discoverAuthorizationServerMetadata()` which makes HTTP request to `/.well-known/oauth-authorization-server`
   - The SDK methods handle the actual HTTP requests to well-known endpoints
   - Discovery Flow:
     1. Attempts to discover resource metadata from the MCP server URL
     2. If resource metadata contains `authorization_servers`, uses the first one; otherwise defaults to MCP server base URL
     3. Discovers OAuth authorization server metadata from the determined authorization server URL
     4. Uses discovered metadata for client registration and authorization
2. **`client_registration`**: **Registers client** (static, DCR, or CIMD)
   - First tries preregistered/static client information (from config)
   - Falls back to Dynamic Client Registration (DCR) if no static client available
   - If `clientMetadataUrl` is provided, uses CIMD (Client ID Metadata Documents) mode
   - Implementation pattern:
     ```typescript
     // Try Static client first, with DCR as fallback
     let fullInformation = await context.provider.clientInformation();
     if (!fullInformation) {
       fullInformation = await registerClient(context.serverUrl, {
         metadata,
         clientMetadata,
       });
       context.provider.saveClientInformation(fullInformation);
     }
     ```
3. **`authorization_redirect`**: Generates authorization URL with PKCE
   - Calls SDK `startAuthorization()` which generates PKCE code challenge
   - Builds authorization URL with all required parameters
   - Saves code verifier for later token exchange
4. **`authorization_code`**: User provides authorization code (manual entry or callback)
   - Validates authorization code input
   - In guided mode, waits for user to enter code or receive via callback
5. **`token_request`**: Exchanges code for tokens
   - Calls SDK `exchangeAuthorization()` with authorization code and code verifier
   - Receives OAuth tokens (access_token, refresh_token, etc.)
   - Saves tokens to storage
6. **`complete`**: Final state with tokens
   - OAuth flow complete
   - Tokens available for use in requests

**Why It's Core**:

- Provides transparency into OAuth flow (critical for debugging)
- Allows manual intervention at each step
- Shows full OAuth state (metadata, client info, tokens)
- Essential for troubleshooting OAuth issues
- Users expect this level of visibility in a developer tool

**InspectorClient Integration**:

- InspectorClient should support both automatic and guided modes
- Guided mode should expose state machine state via events/API
- CLI/TUI can use guided mode for step-by-step OAuth flow
- State machine should be part of initial implementation, not a future enhancement

### OAuth Mode Implementation Details

#### DCR (Dynamic Client Registration) Support

**Behavior**:

- ✅ Tries preregistered/static client info first (from Zustand store, set via config)
- ✅ Falls back to DCR via SDK `registerClient()` if no static client is found
- ✅ Client information is stored in Zustand store after registration

**Storage**:

- Preregistered clients: Stored in Zustand store as `preregisteredClientInformation`
- Dynamically registered clients: Stored in Zustand store as `clientInformation`
- The `clientInformation()` method checks preregistered first, then dynamic

#### RFC 8414 Authorization Server Metadata Discovery

**Behavior**:

- ✅ Always initiates discovery client-side (never uses server-provided metadata from MCP capabilities)
- ✅ Discovers resource metadata from `/.well-known/oauth-protected-resource` via SDK `discoverOAuthProtectedResourceMetadata()`
- ✅ Discovers OAuth authorization server metadata from `/.well-known/oauth-authorization-server` via SDK `discoverAuthorizationServerMetadata()`
- ✅ No code path uses server-provided metadata from MCP server capabilities
- ✅ SDK methods handle the actual HTTP requests to well-known endpoints

**Discovery Flow**:

1. Attempts to discover resource metadata from the MCP server URL
2. If resource metadata contains `authorization_servers`, uses the first one; otherwise defaults to MCP server base URL
3. Discovers OAuth authorization server metadata from the determined authorization server URL
4. Uses discovered metadata for client registration and authorization

**Note**: This is RFC 8414 discovery (client discovering server endpoints), not CIMD. CIMD is a separate concept (server discovering client information via URL-based client IDs).

#### CIMD (Client ID Metadata Documents) Support

**Status**: ✅ **Supported** (new in InspectorClient, not in current web client)

**What CIMD Is**:

- CIMD (Client ID Metadata Documents, SEP-991) is the DCR replacement introduced in the November 2025 MCP spec
- The client publishes its metadata at a URL (e.g., `https://inspector.app/.well-known/oauth-client-metadata`)
- That URL becomes the `client_id` (instead of a random string from DCR)
- The authorization server fetches that URL to discover client information (name, redirect_uris, etc.)
- This is "reverse discovery" - the server discovers the client, not the client discovering the server

**How InspectorClient Supports CIMD**:

- User provides `clientMetadataUrl` in OAuth config
- `NodeOAuthClientProvider` sets `clientMetadataUrl` in `clientMetadata`
- SDK checks for CIMD support and uses URL-based client ID if supported
- Falls back to DCR if authorization server doesn't support CIMD

**What's Required for CIMD**:

1. Publish client metadata at a publicly accessible URL
2. Set `clientMetadataUrl` in OAuth config
3. The authorization server must support `client_id_metadata_document_supported: true`

### OAuth Flow Descriptions

#### Automatic Flow (Quick Mode)

1. **Configuration**: User provides OAuth config (clientId, clientSecret, scope, clientMetadataUrl) via `InspectorClientOptions` or `setOAuthConfig()`
2. **Storage**: Config saved to Zustand store as `preregisteredClientInformation` (if static client provided)
3. **Initiation**: User calls `authenticate()` (or `authenticateGuided()` for guided mode). We do not auto-initiate on 401; callers authenticate first, then connect.
4. **SDK Handles**:
   - Authorization server metadata discovery (RFC 8414 - always client-initiated)
   - Client registration (static, DCR, or CIMD based on config)
   - Authorization redirect (generates PKCE challenge, builds authorization URL)
5. **Navigation**: Authorization URL dispatched via `oauthAuthorizationRequired` event
6. **User Action**: User navigates to authorization URL (via callback handler, browser open, or manual navigation)
7. **Callback**: Authorization server redirects to callback URL with authorization code
8. **Processing**: User provides authorization code via `completeOAuthFlow()`
9. **Token Exchange**: SDK exchanges code for tokens (using stored code verifier)
10. **Storage**: Tokens saved to Zustand store
11. **Connect**: User calls `connect()`. Transport is created with `authProvider` (tokens in storage). SDK injects tokens and handles 401 (auth, retry) inside the transport. We do not retry connect or requests after OAuth; the transport does.

#### Guided Flow (Step-by-Step Mode)

1. **Initiation**: User calls `authenticateGuided()` to begin guided flow
2. **State Machine**: `OAuthStateMachine` executes steps manually
3. **Step Control**: Each step can be viewed and manually progressed via `proceedOAuthStep()`
4. **State Visibility**: Full OAuth state available via `getOAuthState()` and `oauthStepChange` events
5. **Events**: `oauthStepChange` event dispatched on each step transition with current state
   - Event detail includes: `step`, `previousStep`, and `state` (partial state update)
   - UX layer can listen to update UI, enable/disable buttons, show step-specific information
6. **Authorization**: Authorization URL generated and dispatched via `oauthAuthorizationRequired` event
7. **Code Entry**: Authorization code can be entered manually or received via callback
8. **Completion**: `oauthComplete` event dispatched, full state visible, tokens stored in Zustand store

## InspectorClient Integration

### New Options

```typescript
export interface InspectorClientOptions {
  // ... existing options ...

  /**
   * OAuth configuration
   */
  oauth?: {
    /**
     * Preregistered client ID (optional, will use DCR if not provided)
     * If clientMetadataUrl is provided, this is ignored (CIMD mode)
     */
    clientId?: string;

    /**
     * Preregistered client secret (optional, only if client requires secret)
     * If clientMetadataUrl is provided, this is ignored (CIMD mode)
     */
    clientSecret?: string;

    /**
     * Client metadata URL for CIMD (Client ID Metadata Documents) mode
     * If provided, enables URL-based client IDs (SEP-991)
     * The URL becomes the client_id, and the authorization server fetches it to discover client metadata
     */
    clientMetadataUrl?: string;

    /**
     * OAuth scope (optional, will be discovered if not provided)
     */
    scope?: string;

    /**
     * Redirect URL for OAuth callback (required for OAuth flow)
     * For CLI/TUI, this should be a local server URL or manual callback URL
     */
    redirectUrl?: string;

    /**
     * Storage path for OAuth data (default: ~/.mcp-inspector/oauth/)
     */
    storagePath?: string;
  };
}
```

### New Methods

```typescript
class InspectorClient {
  // OAuth configuration
  setOAuthConfig(config: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string; // For CIMD mode
    scope?: string;
    redirectUrl?: string;
  }): void;

  // OAuth flow initiation (normal mode)
  /**
   * Initiates OAuth flow (user-initiated or 401-triggered). Both paths use this method.
   * Returns the authorization URL. Dispatches 'oauthAuthorizationRequired' event.
   */
  async authenticate(): Promise<URL>;

  /**
   * Completes OAuth flow with authorization code
   * @param authorizationCode - Authorization code from OAuth callback
   * Dispatches 'oauthComplete' event on success
   * Dispatches 'oauthError' event on failure
   */
  async completeOAuthFlow(authorizationCode: string): Promise<void>;

  // OAuth state management
  /**
   * Gets current OAuth tokens (if authorized)
   */
  getOAuthTokens(): OAuthTokens | undefined;

  /**
   * Clears OAuth tokens and client information
   */
  clearOAuthTokens(): void;

  /**
   * Checks if client is currently OAuth authorized
   */
  isOAuthAuthorized(): boolean;

  /**
   * Initiates OAuth flow in guided mode (step-by-step, state machine).
   * Returns the authorization URL. Dispatches 'oauthAuthorizationRequired' and 'oauthStepChange' events.
   */
  async authenticateGuided(): Promise<URL>;

  // Guided mode state management
  /**
   * Get current OAuth state machine state (for guided mode)
   * Returns undefined if not in guided mode
   */
  getOAuthState(): AuthGuidedState | undefined;

  /**
   * Get current OAuth step (for guided mode)
   * Returns undefined if not in guided mode
   */
  getOAuthStep(): OAuthStep | undefined;

  /**
   * Manually progress to next step in guided OAuth flow
   * Only works when in guided mode
   * Dispatches 'oauthStepChange' event on step transition
   */
  async proceedOAuthStep(): Promise<void>;
}
```

### OAuth Flow Initiation

**Two Modes of Initiation**:

1. **Normal Mode** (User-Initiated):
   - User calls `client.authenticate()` explicitly
   - Uses SDK's `auth()` function internally
   - Returns authorization URL
   - Dispatches `oauthAuthorizationRequired` event
   - Client-side (CLI/TUI) listens for events and handles navigation
   - User completes OAuth (e.g. via callback), then calls `completeOAuthFlow(code)`, then `connect()`. The transport uses `authProvider` to inject tokens; the SDK handles 401 (auth, retry) internally. We do not automatically retry connect or requests after OAuth.

2. **Guided Mode** (User-Initiated):
   - User calls `client.authenticateGuided()` explicitly
   - Uses state machine for step-by-step control
   - Dispatches `oauthStepChange` events as flow progresses
   - Returns authorization URL
   - Dispatches `oauthAuthorizationRequired` event
   - Client-side listens for events and handles navigation
   - Same flow as normal: complete OAuth, then `connect()`.

**Event-Driven Architecture**:

```typescript
// InspectorClient dispatches events for OAuth flow
this.dispatchTypedEvent("oauthAuthorizationRequired", {
  url: authorizationUrl,
});

this.dispatchTypedEvent("oauthComplete", { tokens });
this.dispatchTypedEvent("oauthError", { error });

// InspectorClient dispatches events for guided flow
this.dispatchTypedEvent("oauthStepChange", {
  step: OAuthStep,
  previousStep?: OAuthStep,
  state: Partial<AuthGuidedState>
});

// Client-side (CLI/TUI) listens for events
client.addEventListener("oauthAuthorizationRequired", (event) => {
  const { url } = event.detail;
  // Handle navigation (print URL, open browser, etc.)
  // Wait for user to provide authorization code
  // Call client.completeOAuthFlow(code)
});

// For guided mode, listen for step changes
client.addEventListener("oauthStepChange", (event) => {
  const { step, state } = event.detail;
  // Update UI to show current step and state
  // Enable/disable "Continue" button based on step
});
```

**Event-Driven Architecture**:

- InspectorClient dispatches `oauthAuthorizationRequired` events
- Callers are responsible for registering event listeners to handle the authorization URL
- CLI/TUI applications should register listeners to display the URL (e.g., print to console, show in UI)
- No default console output - callers must explicitly handle events

**401 Error Handling (legacy; see authProvider migration below)**:

InspectorClient previously detected 401 in `connect()` and request methods, called `authenticate()`, stored a pending request, and retried after OAuth. This custom logic has been **removed**. 401 handling is now delegated to the SDK transport via `authProvider`.

### Token Injection and authProvider (Current Implementation)

**Integration Point**: For HTTP-based transports (SSE, streamable-http), we pass an **`authProvider`** (`OAuthClientProvider`) into `createTransport`. The SDK injects tokens and handles 401 via the provider; we do not manually add `Authorization` headers or detect 401.

- **Transport creation**: All transport creation happens in **`connect()`** (single place for create, wrap, attach). When OAuth is configured, we create a provider via `createOAuthProvider("normal" | "guided")` and pass it as `authProvider` to `createTransport`; the provider is created async there.
- **Flow**: Callers **authenticate first**, then connect. Run `authenticate()` or `authenticateGuided()`, complete OAuth with `completeOAuthFlow(code)`, then call `connect()`. The transport uses `authProvider` to inject tokens; the SDK handles 401 (auth, retry) inside the transport.
- **No connect-time 401 retry**: We do not catch 401 on `connect()` or retry. If `connect()` is called without tokens, the transport/SDK may throw (e.g. `Unauthorized`). Callers must run `authenticate()` (or guided flow), then retry `connect()`.
- **Request methods**: We no longer wrap `listTools`, `listResources`, etc. with 401 detection or retry. The transport handles 401 for all requests when `authProvider` is used.
- **Removed**: `getOAuthToken` callback, `createOAuthFetchWrapper`, `is401Error`, `handleRequestWithOAuth`, `pendingOAuthRequest`, and connect-time 401 catch block.

## Implementation Plan

### Phase 1: Extract and Abstract OAuth Components

**Goal**: Copy general-purpose OAuth code to shared package with abstractions (leaving web client code unchanged)

1. **Create Zustand Store** (`shared/auth/store.ts`)
   - Install Zustand dependency (with persist middleware support)
   - Create `createOAuthStore()` factory function
   - Implement browser storage adapter (sessionStorage) for Zustand persist
   - Implement file storage adapter (Node.js fs) for Zustand persist
   - Export vanilla API (`getOAuthStore()`) only (no React dependencies)
   - React hooks (if needed) would be in separate `shared/react/auth/hooks.ts` file
   - Add `getServerSpecificKey()` helper

2. **Create Redirect URL Abstraction** (`shared/auth/providers.ts` - part 1)
   - Define `RedirectUrlProvider` interface with `getRedirectUrl()` and `getDebugRedirectUrl()` methods
   - Implement `BrowserRedirectUrlProvider` (returns normal and debug URLs based on `window.location.origin`)
   - Implement `LocalServerRedirectUrlProvider` (constructor takes `port`, returns normal and debug URLs)
   - Implement `ManualRedirectUrlProvider` (constructor takes `baseUrl`, returns normal and debug URLs)
   - **Key**: Both URLs are available, both are registered with OAuth server, mode determines which is used for current flow

3. **Create Navigation Abstraction** (`shared/auth/providers.ts` - part 2)
   - Define `OAuthNavigation` interface
   - Implement `BrowserNavigation`
   - Implement `ConsoleNavigation`
   - Implement `CallbackNavigation`

4. **Create Base OAuth Provider** (`shared/auth/providers.ts` - part 3)
   - Create `BaseOAuthClientProvider` abstract class
   - Implement shared SDK interface methods
   - Move storage, redirect URL, and navigation logic to base class
   - Add support for `clientMetadataUrl` (CIMD mode)

5. **Create Provider Implementations** (`shared/auth/providers.ts` - part 4)
   - Create `BrowserOAuthClientProvider` (extends base, uses sessionStorage directly - for web client reference)
   - Create `NodeOAuthClientProvider` (extends base, uses Zustand store - for InspectorClient/CLI/TUI)
   - Support all three client identification modes: static, DCR, CIMD

6. **Copy OAuth Utilities** (`shared/auth/utils.ts`)
   - Copy `parseOAuthCallbackParams()` from `client/src/utils/oauthUtils.ts`
   - Copy `generateOAuthErrorDescription()` from `client/src/utils/oauthUtils.ts`
   - Adapt `generateOAuthState()` to support both browser and Node.js

7. **Copy OAuth State Machine** (`shared/auth/state-machine.ts`)
   - Copy `OAuthStateMachine` class from `client/src/lib/oauth-state-machine.ts`
   - Copy `oauthTransitions` object
   - Update to use abstract `OAuthClientProvider` instead of `DebugInspectorOAuthClientProvider`

8. **Copy Scope Discovery** (`shared/auth/discovery.ts`)
   - Copy `discoverScopes()` from `client/src/lib/auth.ts`

9. **Create Types Module** (`shared/auth/types.ts`)
   - Copy `CallbackParams` type from `client/src/utils/oauthUtils.ts`
   - Re-export SDK OAuth types as needed

### Phase 2: (Skipped - Web Client Unchanged)

**Note**: Web client OAuth code remains in place and is not modified at this time. Future migration options:

- Option A: Web client uses shared auth code directly
- Option B: Web client relies on InspectorClient for OAuth
- Option C: Hybrid approach (some components use shared code, others use InspectorClient)

These options should be considered in the design but not implemented now.

### Phase 3: Integrate OAuth into InspectorClient

**Goal**: Add OAuth support to InspectorClient with both direct and indirect initiation

1. **Add OAuth Options to InspectorClientOptions**
   - Add `oauth` configuration option with support for `clientMetadataUrl` (CIMD)
   - Define OAuth configuration interface
   - Support all three client identification modes

2. **Add OAuth Provider to InspectorClient**
   - Store OAuth config
   - Create `NodeOAuthClientProvider` instances on-demand based on mode (lazy initialization)
   - Normal mode provider created by default (for automatic flows)
   - Guided mode provider created when `authenticateGuided()` is called
   - Initialize Zustand store for OAuth state
   - **Important**: Both redirect URLs are registered with OAuth server (allows switching modes without re-registering)
   - Both callback handlers are mounted (normal at `/oauth/callback`, guided at `/oauth/callback/guided`)
   - The provider's mode determines which URL is used for the current flow

3. **Implement OAuth Methods**
   - Implement `setOAuthConfig()` (supports clientMetadataUrl for CIMD)
   - Implement `authenticate()` (direct and 401-triggered initiation, uses normal-mode provider)
   - Implement `completeOAuthFlow()`
   - Implement `getOAuthTokens()`
   - Implement `clearOAuthTokens()`
   - Implement `isOAuthAuthorized()`
   - Implement guided mode state management methods:
     - `getOAuthState()` - Get current OAuth state machine state (returns undefined if not in guided mode)
     - `getOAuthStep()` - Get current OAuth step (returns undefined if not in guided mode)
     - `proceedOAuthStep()` - Manually progress to next step (only works in guided mode, dispatches `oauthStepChange` event)
   - **Note**: Guided mode is initiated via `authenticateGuided()`, which creates a provider with `mode="guided"` and initiates the flow
   - **Note**: When creating `NodeOAuthClientProvider`, pass the `mode` parameter. Both redirect URLs are registered, but the provider uses the URL matching its mode for the current flow.

4. **~~Add 401 Error Detection~~** (removed in authProvider migration)
   - We no longer use `is401Error()` or detect 401 in connect/request methods. The transport handles 401 via `authProvider`.

5. **Add OAuth Flow Initiation (User-Initiated Only)**
   - User calls `authenticate()` or `authenticateGuided()` first, then `completeOAuthFlow(code)`, then `connect()`. We do not catch 401 or retry; the transport uses `authProvider` for token injection and 401 handling.

6. **Add Guided Mode**
   - Implement `authenticateGuided()` for step-by-step OAuth flow
   - Create provider with `mode="guided"` when `authenticateGuided()` is called
   - Dispatch `oauthAuthorizationRequired` and `oauthStepChange` events as state machine progresses

7. **Add Token Injection (via authProvider)**
   - For HTTP-based transports with OAuth, pass `authProvider` into `createTransport`. The SDK injects tokens and handles 401. We do not manually add `Authorization` headers. All transport creation happens in `connect()`.
   - Refresh tokens if expired (future enhancement) – handled by SDK/authProvider when supported.

8. **Add OAuth Events**
   - Add `oauthAuthorizationRequired` event (dispatches authorization URL, mode, optional originalError)
   - Add `oauthComplete` event (dispatches tokens)
   - Add `oauthError` event (dispatches error)
   - Add `oauthStepChange` event (dispatches step, previousStep, state) - for guided mode
   - All events are event-driven for client-side integration
   - Callers must register event listeners to handle `oauthAuthorizationRequired` events

### Phase 4: Testing

**Goal**: Comprehensive testing of OAuth support

1. **Unit Tests for Shared OAuth Components**
   - Test storage adapters (Browser, Memory, File)
   - Test redirect URL providers
   - Test navigation handlers
   - Test OAuth utilities
   - Test state machine transitions
   - Test scope discovery

2. **Integration Tests for InspectorClient OAuth**
   - Test OAuth configuration
   - Test 401 error detection and OAuth flow initiation
   - Test token injection in HTTP transports
   - Test OAuth flow completion
   - Test token storage and retrieval
   - Test OAuth error handling

3. **End-to-End Tests with OAuth Test Server**
   - Test full OAuth flow with test server (see "OAuth Test Server Infrastructure" below)
   - Test static/preregistered client mode
   - Test DCR (Dynamic Client Registration) mode
   - Test CIMD (Client ID Metadata Documents) mode
   - Test scope discovery
   - Test token refresh (if supported)
   - Test OAuth cleanup
   - Test 401 error handling and automatic retry

4. **Web Client Regression Tests**
   - Verify all existing OAuth tests still pass
   - Test normal OAuth flow
   - Test debug OAuth flow
   - Test OAuth callback handling

## OAuth Test Server Infrastructure

### Overview

OAuth testing requires a full OAuth 2.1 authorization server that can:

- Return 401 errors on MCP requests (to trigger OAuth flow initiation)
- Serve OAuth metadata endpoints (RFC 8414 discovery)
- Handle all three client identification modes (static, DCR, CIMD)
- Support authorization and token exchange flows
- Verify Bearer tokens on protected MCP endpoints

**Decision**: Use **better-auth** (or similar third-party OAuth library) for the test server rather than implementing OAuth from scratch. This provides:

- Faster implementation
- Production-like OAuth behavior
- Better security coverage
- Reduced maintenance burden

### Integration with Existing Test Infrastructure

The OAuth test server will integrate with the existing `composable-test-server.ts` infrastructure:

1. **Extend `ServerConfig` Interface** (`shared/test/composable-test-server.ts`):

   ```typescript
   export interface ServerConfig {
     // ... existing config ...
     oauth?: {
       /**
        * Whether OAuth is enabled for this test server
        */
       enabled: boolean;

       /**
        * OAuth authorization server issuer URL
        * Used for metadata endpoints and token issuance
        */
       issuerUrl: URL;

       /**
        * List of scopes supported by this authorization server
        */
       scopesSupported?: string[];

       /**
        * If true, MCP endpoints require valid Bearer token
        * Returns 401 Unauthorized if token is missing or invalid
        */
       requireAuth?: boolean;

       /**
        * Static/preregistered clients for testing
        * These clients are pre-configured and don't require DCR
        */
       staticClients?: Array<{
         clientId: string;
         clientSecret?: string;
         redirectUris?: string[];
       }>;

       /**
        * Whether to support Dynamic Client Registration (DCR)
        * If true, exposes /register endpoint for client registration
        */
       supportDCR?: boolean;

       /**
        * Whether to support CIMD (Client ID Metadata Documents)
        * If true, server will fetch client metadata from clientMetadataUrl
        */
       supportCIMD?: boolean;

       /**
        * Token expiration time in seconds (default: 3600)
        */
       tokenExpirationSeconds?: number;

       /**
        * Whether to support refresh tokens (default: true)
        */
       supportRefreshTokens?: boolean;
     };
   }
   ```

2. **Extend `TestServerHttp`** (`shared/test/test-server-http.ts`):
   - Install better-auth OAuth router on Express app (before MCP routes)
   - Add Bearer token verification middleware on `/mcp` endpoint
   - Return 401 if `requireAuth: true` and no valid token present
   - Serve OAuth metadata endpoints:
     - `/.well-known/oauth-authorization-server` (RFC 8414)
     - `/.well-known/oauth-protected-resource` (RFC 8414)
   - Handle client registration endpoint (`/register`) if DCR enabled
   - Handle authorization endpoint (`/authorize`) - see "Authorization Endpoint" below
   - Handle token endpoint (`/token`)
   - Handle token revocation endpoint (`/revoke`) if supported

   **Authorization Endpoint Implementation**:
   - better-auth provides the authorization endpoint (`/oauth/authorize` or similar)
   - For automated testing, create a **test authorization page** that:
     - Accepts authorization requests (client_id, redirect_uri, scope, state, code_challenge)
     - Automatically approves the request (no user interaction required)
     - Redirects to `redirect_uri` with authorization code and state
   - This allows tests to programmatically complete the OAuth flow without browser automation
   - For true E2E tests requiring user interaction, better-auth's built-in UI can be used

3. **Create OAuth Test Fixtures** (`shared/test/test-server-fixtures.ts`):

   ```typescript
   /**
    * Creates a test server configuration with OAuth enabled
    */
   export function createOAuthTestServerConfig(options: {
     requireAuth?: boolean;
     scopesSupported?: string[];
     staticClients?: Array<{ clientId: string; clientSecret?: string }>;
     supportDCR?: boolean;
     supportCIMD?: boolean;
   }): ServerConfig;

   /**
    * Creates OAuth configuration for InspectorClient tests
    */
   export function createOAuthClientConfig(options: {
     mode: "static" | "dcr" | "cimd";
     clientId?: string;
     clientSecret?: string;
     clientMetadataUrl?: string;
     redirectUrl: string;
   }): InspectorClientOptions["oauth"];

   /**
    * Helper function to programmatically complete OAuth authorization
    * Makes HTTP GET request to authorization URL and extracts authorization code
    * @param authorizationUrl - The authorization URL from oauthAuthorizationRequired event
    * @returns Authorization code extracted from redirect URL
    */
   export async function completeOAuthAuthorization(
     authorizationUrl: URL,
   ): Promise<string>;
   ```

### Authorization Endpoint and Test Flow

**Authorization Endpoint**:
The test server will provide a functioning OAuth authorization endpoint (via better-auth) that:

1. **Accepts Authorization Requests**: The endpoint receives authorization requests with:
   - `client_id`: The OAuth client identifier
   - `redirect_uri`: Where to redirect after approval
   - `scope`: Requested OAuth scopes
   - `state`: CSRF protection state parameter
   - `code_challenge`: PKCE code challenge
   - `response_type`: Always "code" for authorization code flow

2. **Test Authorization Page**: For automated testing, the test server will provide a simple authorization page that:
   - Automatically approves all authorization requests (no user interaction)
   - Generates an authorization code
   - Redirects to `redirect_uri` with the code and state parameter
   - This allows tests to programmatically complete OAuth without browser automation

3. **Programmatic Authorization Helper**: Tests can use a helper function to:
   - Extract authorization URL from `oauthAuthorizationRequired` event
   - Make HTTP GET request to authorization URL
   - Parse redirect response to extract authorization code
   - Call `client.completeOAuthFlow(authorizationCode)` to complete the flow

**Example Test Flow**:

```typescript
// 1. Configure test server with OAuth enabled
const server = new TestServerHttp({
  ...getDefaultServerConfig(),
  oauth: {
    enabled: true,
    requireAuth: true,
    staticClients: [{ clientId: "test-client", clientSecret: "test-secret" }],
  },
});
await server.start();

// 2. Configure InspectorClient with OAuth
const client = new InspectorClient({
  serverUrl: server.url,
  oauth: {
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUrl: "http://localhost:3000/oauth/callback",
  },
});

// 3. Listen for OAuth authorization required event
let authUrl: URL | null = null;
client.addEventListener("oauthAuthorizationRequired", (event) => {
  authUrl = event.detail.url;
});

// 4. Make MCP request (triggers 401, then OAuth flow)
try {
  await client.listTools();
} catch (error) {
  // Expected: 401 error triggers OAuth flow
}

// 5. Programmatically complete authorization
if (authUrl) {
  // Make GET request to authorization URL (auto-approves in test server)
  const response = await fetch(authUrl.toString(), { redirect: "manual" });
  const redirectUrl = response.headers.get("location");

  // Extract authorization code from redirect URL
  const redirectUrlObj = new URL(redirectUrl!);
  const code = redirectUrlObj.searchParams.get("code");

  // Complete OAuth flow
  await client.completeOAuthFlow(code!);

  // 6. Retry original request (should succeed with token)
  const tools = await client.listTools();
  expect(tools).toBeDefined();
}
```

### Test Scenarios

**Static Client Mode**:

- Configure test server with `staticClients`
- Configure InspectorClient with matching `clientId`/`clientSecret`
- Test full OAuth flow without DCR
- Verify authorization endpoint auto-approves and redirects with code

**DCR Mode**:

- Configure test server with `supportDCR: true`
- Configure InspectorClient without `clientId` (triggers DCR)
- Test client registration, then full OAuth flow
- Verify DCR endpoint registers client, then authorization flow proceeds

**CIMD Mode**:

- Configure test server with `supportCIMD: true`
- Configure InspectorClient with `clientMetadataUrl`
- Test server fetches client metadata from URL
- Test full OAuth flow with URL-based client ID

**401 Error Handling**:

- Configure test server with `requireAuth: true`
- Make MCP request without token → expect 401
- Verify `oauthAuthorizationRequired` event dispatched
- Programmatically complete OAuth flow (auto-approve authorization)
- Verify original request automatically retried with token

**Token Verification**:

- Configure test server with `requireAuth: true`
- Make MCP request with valid Bearer token → expect success
- Make MCP request with invalid/expired token → expect 401

### Implementation Steps

1. **Install better-auth dependency** (or chosen OAuth library)
   - Add to `shared/package.json` as dev dependency

2. **Create OAuth test server wrapper** (`shared/test/oauth-test-server.ts`)
   - Wrap better-auth configuration
   - Integrate with Express app in `TestServerHttp`
   - Handle static clients, DCR, CIMD modes
   - Create test authorization page that auto-approves requests
   - Provide helper function to programmatically extract authorization code from redirect

3. **Extend `ServerConfig` interface**
   - Add `oauth` configuration option
   - Update `createMcpServer()` to handle OAuth config

4. **Extend `TestServerHttp`**
   - Install OAuth router before MCP routes
   - Add Bearer token middleware
   - Return 401 when `requireAuth: true` and token invalid

5. **Create test fixtures**
   - `createOAuthTestServerConfig()`
   - `createOAuthClientConfig()`
   - Helper functions for common OAuth test scenarios

6. **Write integration tests**
   - Test each client identification mode
   - Test 401 error handling
   - Test token verification
   - Test full OAuth flow end-to-end

## Storage Strategy

### InspectorClient Storage (Node.js) - Zustand with File Persistence

**Location**: `~/.mcp-inspector/oauth/state.json` (single Zustand store file)

**Storage Format**:

```json
{
  "state": {
    "servers": {
      "https://example.com/mcp": {
        "tokens": { "access_token": "...", "refresh_token": "..." },
        "clientInformation": { "client_id": "...", ... },
        "preregisteredClientInformation": { "client_id": "...", ... },
        "codeVerifier": "...",
        "scope": "...",
        "serverMetadata": { ... }
      }
    }
  },
  "version": 0
}
```

**Benefits**:

- Single file for all OAuth state across all servers
- Zustand handles serialization/deserialization automatically
- Atomic writes via Zustand's persist middleware
- Type-safe state management
- Easier to backup/restore (one file)

**Security Considerations**:

- File contains sensitive data (tokens, secrets)
- Use restrictive file permissions (600) for state.json
- Consider encryption for production use (future enhancement)

### Web Client Storage (Browser)

**Location**: Browser `sessionStorage` (unchanged - web client code not modified)

**Key Format**: `[${serverUrl}] ${baseKey}` (unchanged)

## Navigation Strategy

### InspectorClient Navigation

**Event-Driven Architecture**: InspectorClient dispatches `oauthAuthorizationRequired` events. Callers must register event listeners to handle these events.

**UX Layer Options**:

1. **Console Output**: Register event listener to print URL, wait for user to paste callback URL or authorization code
2. **Browser Open**: Register event listener to open URL in default browser (if available)
3. **Custom Navigation**: Register event listener to handle redirect in any custom way

**Example Flow**:

```
1. InspectorClient detects 401 error
2. Initiates OAuth flow
3. Dispatches 'oauthAuthorizationRequired' event
4. If no listener registered, prints: "Please navigate to: https://auth.example.com/authorize?..."
5. UX layer listens for event and handles navigation (print, open browser, etc.)
6. Waits for user to provide authorization code or callback URL
7. User calls client.completeOAuthFlow(code)
8. Dispatches 'oauthComplete' event
9. Retries original request
```

## Error Handling

### OAuth Flow Errors

- **Discovery Errors**: Log and continue (fallback to server URL)
- **Registration Errors**: Log and throw (user must provide static client)
- **Authorization Errors**: Dispatch `oauthError` event, throw error
- **Token Exchange Errors**: Dispatch `oauthError` event, throw error

### 401 Error Handling

- **Transport / authProvider**: The SDK transport handles 401 when `authProvider` is used (token injection, auth, retry). InspectorClient does not detect 401 or retry connect/requests.
- **Caller flow**: Authenticate first (`authenticate()` or `authenticateGuided()`), complete OAuth, then `connect()`. If `connect()` is called without tokens, the transport may throw; callers retry `connect()` after OAuth.
- **Event-Based**: Dispatch events for UI to handle OAuth flow (`oauthAuthorizationRequired`, etc.)

## Migration Notes

### authProvider Migration (2025)

InspectorClient now uses the SDK’s **`authProvider`** (`OAuthClientProvider`) for OAuth on HTTP transports (SSE, streamable-http) instead of a `getOAuthToken` callback and custom 401 handling.

**Summary of changes**:

- **Transport**: `createTransport` accepts `authProvider` (optional). For SSE and streamable-http with OAuth, we pass the provider; the SDK injects tokens and handles 401. `getOAuthToken` and OAuth-specific fetch wrapping have been removed.
- **InspectorClient**: All transport creation happens in `connect()` (single place for create, wrap, attach); for HTTP+OAuth the provider is created async there. We pass `authProvider` when creating the transport. On `disconnect()`, we null out the transport so the next `connect()` creates a fresh one. Removed: `is401Error`, `handleRequestWithOAuth`, connect-time 401 catch, and `pendingOAuthRequest`.
- **Caller flow**: **Authenticate first, then connect.** Call `authenticate()` or `authenticateGuided()`, have the user complete OAuth, call `completeOAuthFlow(code)`, then `connect()`. We no longer detect 401 on `connect()` or retry internally; the transport handles 401 when `authProvider` is used.
- **Guided mode**: Unchanged. Use `authenticateGuided()` → `completeOAuthFlow()` → `connect()`. The same provider (or shared storage) is used as `authProvider` when connecting after guided auth.
- **Custom headers**: Config `headers` / `requestInit` / `eventSourceInit` continue to be passed at transport creation and are merged with `authProvider` by the SDK.

See **"Token Injection and authProvider"** above for details.

### Web Client Migration (Future Consideration)

**Current State**: Web client OAuth code remains unchanged and in place.

**Future Migration Options** (not implemented now, but design should support):

1. **Option A: Web Client Uses Shared Auth Code Directly**
   - Web client imports from `shared/auth/`
   - Uses `BrowserOAuthClientProvider` from shared
   - Uses Zustand store with sessionStorage adapter
   - Minimal changes to web client code

2. **Option B: Web Client Relies on InspectorClient for OAuth**
   - Web client creates `InspectorClient` instance
   - Uses InspectorClient's OAuth methods and events
   - InspectorClient handles all OAuth logic
   - Web client UI listens to InspectorClient events

3. **Option C: Hybrid Approach**
   - Some components use shared auth code directly (e.g., utilities, state machine)
   - Other components use InspectorClient (e.g., OAuth flow initiation)
   - Flexible migration path

**Design Considerations**:

- Shared auth code should be usable independently (not require InspectorClient)
- InspectorClient should be usable independently (not require web client)
- React hooks in `shared/react/auth/hooks.ts` can be shared (pure logic, no rendering)
- React UI components cannot be shared (TUI uses Ink, web uses DOM) - each client implements its own

### Breaking Changes

- **None Expected**: All changes are additive (new shared code, new InspectorClient features)
- **Web Client**: Remains completely unchanged
- **API Compatibility**: InspectorClient API is additive only

## Future Enhancements

1. **Token Refresh**: Implemented via the SDK's `authProvider` when `refresh_token` is available; the provider persists and uses refresh tokens for automatic refresh after 401. No additional work required for standard flows.
2. **Encrypted Storage**: Encrypt sensitive OAuth data in Zustand store
3. **Multiple OAuth Providers**: Support multiple OAuth configurations per InspectorClient
4. **Web Client Migration**: Consider migrating web client to use shared auth code or InspectorClient

## References

- Web client OAuth implementation (unchanged): `client/src/lib/auth.ts`, `client/src/lib/oauth-state-machine.ts`, `client/src/utils/oauthUtils.ts`
- [MCP SDK OAuth APIs](https://github.com/modelcontextprotocol/typescript-sdk) - SDK OAuth client and server APIs
- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1) - OAuth 2.1 protocol specification
- [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) - OAuth 2.0 Authorization Server Metadata
- [Zustand Documentation](https://github.com/pmndrs/zustand) - Zustand state management library
- [Zustand Persist Middleware](https://github.com/pmndrs/zustand/blob/main/docs/integrations/persisting-store-data.md) - Zustand persistence middleware
- [SEP-991: Client ID Metadata Documents](https://modelcontextprotocol.io/specification/security/oauth/#client-id-metadata-documents) - CIMD specification
