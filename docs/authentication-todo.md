# Authentication TODO

This file tracks **remaining** authentication-related work: temporary workarounds, hacks, missing test coverage, and missing features.

## SSE 401 Detection Hack

**Location**: `shared/mcp/inspectorClient.ts` - `is401Error()` method

**Issue**: When using SSE transport, EventSource reports 401 Unauthorized responses as 404 errors because the response is not a valid SSE stream (it's JSON). This is a limitation of the EventSource API.

**Current Workaround**: The code treats SSE 404 errors as 401 when OAuth is configured:

```typescript
if (error instanceof SseError) {
  if (error.code === 401) {
    return true;
  }
  // For SSE, when middleware returns 401 with JSON response (not text/event-stream),
  // EventSource may report it as 404 because it's not a valid SSE stream
  // In this case, we need to treat 404 from SSE as potentially a 401 if OAuth is configured
  // This is a workaround for the EventSource limitation
  if (error.code === 404 && this.oauthConfig) {
    return true;
  }
  return false;
}
```

**Why This Is A Hack**: This is a heuristic that assumes any 404 from SSE when OAuth is configured is actually a 401. This could cause false positives if there are legitimate 404 errors.

**Proper Solution**:

- Check the actual HTTP status code from the error event if available
- Or use a different transport (streamable-http) that properly reports 401 status codes
- Or modify the SSE middleware to return a proper SSE error stream instead of JSON

**Review Priority**: Medium - Works for now but should be improved

## SSE Transport Recreation After OAuth

**Location**: `shared/mcp/inspectorClient.ts` - `connect()` method retry logic

**Issue**: For SSE transport, the EventSource connection cannot be restarted once it has been started. If the initial connection fails with a 401 (before OAuth tokens are available), we need to close the old transport and create a new one after OAuth completes.

**Current Implementation**: After OAuth completes, the code:

1. Closes the existing `baseTransport` (which has a failed EventSource)
2. Creates a new transport instance with the same `getOAuthToken` callback
3. The `getOAuthToken` callback automatically retrieves the newly saved token from storage
4. Connects with the new transport instance

**Why This Is Necessary**: EventSource API limitation - once `start()` is called on an SSEClientTransport, it cannot be restarted. The transport must be closed and a new one created.

**Note**: This is not really a "hack" - it's the correct way to handle SSE transport reconnection after authentication. The `getOAuthToken` callback pattern ensures the token is automatically injected without manual token management.

**Remaining Work**: Move this out of the "hacks" list (e.g. into implementation notes or the design doc) so the TODO stays focused on actionable work.

**Review Priority**: Low - This is the correct implementation pattern for SSE

## Timer Delays in E2E Tests

**Location**: `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

**Issue**: Tests use `setTimeout` polling loops to wait for OAuth events instead of proper event-driven waiting.

**Current Implementation**:

```typescript
// Wait for authorization URL with retries
let retries = 0;
while (!authorizationUrl && retries < 20) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  retries++;
}
```

And:

```typescript
// Small delay to ensure transport is fully ready
await new Promise((resolve) => setTimeout(resolve, 100));
```

**Why This Is A Hack**:

- Polling with arbitrary delays is fragile and can cause flaky tests
- The delays (50ms, 100ms) are arbitrary and may not be sufficient on slower systems
- Proper event-driven waiting would be more reliable

**Proper Solution**:

- Use proper event listeners with promises that resolve when events fire
- Use `vi.waitFor()` or similar test utilities for async state changes
- Remove arbitrary delays and rely on actual state changes

**Review Priority**: Medium - Tests work but are fragile

## Type Casts: Error Property Access

**Location**: `shared/mcp/inspectorClient.ts` lines 626-627

**Issue**: Accessing `code` and `status` properties on errors using `as any` without proper type checking.

**Current Implementation**:

```typescript
errorCode: (error as any)?.code,
errorStatus: (error as any)?.status,
```

**Why This Is A Hack**:

- Bypasses TypeScript's type safety
- Assumes error objects have these properties without verification
- Should use proper type guards or error type checking

**Proper Solution**:

- Create proper error type guards (e.g., `isErrorWithCode`, `isErrorWithStatus`)
- Use discriminated unions for error types
- Check for properties before accessing them

**Review Priority**: Low - Works but loses type safety

## Type Casts: Express Request Extension

**Location**: `shared/test/test-server-oauth.ts` line 107

**Issue**: Attaching custom `oauthToken` property to Express request object using `as any`.

**Current Implementation**:

```typescript
(req as any).oauthToken = token;
```

**Why This Is A Hack**:

- Extends Express Request type without proper type declaration
- Bypasses TypeScript's type checking

**Proper Solution**:

- Create a proper TypeScript module augmentation for Express Request
- Or use a Map/WeakMap to store request-specific data
- Or pass token through middleware context/res.locals

**Review Priority**: Low - Works but not type-safe

## Type Casts: Private Method Access in Tests

**Location**: `shared/__tests__/inspectorClient-oauth.test.ts` lines 87, 94, 101, 108

**Issue**: Accessing private `is401Error` method using `as any` for testing.

**Current Implementation**:

```typescript
const is401 = (client as any).is401Error(error);
```

**Why This Is A Hack**:

- Tests are accessing private implementation details
- Makes tests brittle to refactoring
- Should test through public API

**Proper Solution**:

- Make `is401Error` a public method if it needs to be tested
- Or test indirectly through public methods that use it
- Or use TypeScript's `@internal` and proper test utilities

**Review Priority**: Low - Common testing pattern but not ideal

## Type Casts: Global Object Mocking

**Location**:

- `shared/__tests__/auth/providers.test.ts` lines 70, 103, 149, 166, 170
- `shared/__tests__/auth/storage-browser.test.ts` line 32

**Issue**: Mocking `window` and `sessionStorage` using `(global as any)`.

**Current Implementation**:

```typescript
(global as any).window = { location: { origin: "..." } };
(global as any).sessionStorage = mockSessionStorage;
```

**Why This Is A Hack**:

- Bypasses TypeScript's type checking for global objects
- Can cause issues if not cleaned up properly

**Proper Solution**:

- Use proper mocking libraries (e.g., `@vitest/spy` or `jsdom`)
- Or create proper type declarations for test globals
- Ensure proper cleanup in `afterEach`

**Review Priority**: Low - Common testing pattern, works with proper cleanup

## Type Casts: Mock Provider Creation

**Location**: `shared/__tests__/auth/state-machine.test.ts` line 48

**Issue**: Creating mock provider using `as unknown as BaseOAuthClientProvider`.

**Current Implementation**:

```typescript
} as unknown as BaseOAuthClientProvider;
```

**Why This Is A Hack**:

- Double cast (`as unknown as`) is a code smell
- Mock doesn't fully implement the interface

**Proper Solution**:

- Use proper mocking library (e.g., `vi.fn()` with full implementation)
- Or create a proper test double class that implements the interface
- Or use `Partial<BaseOAuthClientProvider>` if partial mocks are acceptable

**Review Priority**: Low - Works but could be cleaner

## Type Casts: Metadata Property Access

**Location**:

- `shared/test/test-server-http.ts` lines 111, 132
- `shared/test/test-server-fixtures.ts` line 306

**Issue**: Accessing `_meta` property on params using `as any`, and `schema as any` with TODO comment.

**Current Implementation**:

```typescript
const metadata = (params as any)._meta as Record<string, string>;
const schema = params.schema as any; // TODO: This is also not ideal
```

**Why This Is A Hack**:

- Bypasses type safety
- `_meta` is an internal/undocumented property
- TODO comment indicates known issue

**Proper Solution**:

- Define proper types for params that include metadata
- Or use a proper metadata extraction utility with type guards
- Remove TODO and implement proper typing

**Review Priority**: Medium - Has TODO comment indicating known issue

## Missing Features from Design Document

**Location**: Various - comparing `docs/oauth-inspectorclient-design.md` with implementation

**Issue**: Some features mentioned in the design document are not fully implemented or tested.

**Missing/Incomplete Features**:

2. **Token Refresh Support**:
   - **Design Requirement** (line 1348): "Token Refresh: Automatic token refresh when access token expires" (Future Enhancement)
   - Not implemented - refresh tokens are received and stored, but not used for automatic refresh
   - **Test Server**: Supports refresh token flow (`grant_type === "refresh_token"`), but InspectorClient doesn't use it
   - **Impact**: Tokens expire and require manual re-authentication
   - **Proper Solution**: Implement token refresh logic that:
     - Checks token expiration before making requests
     - Automatically refreshes using `refresh_token` if expired
     - Retries original request after refresh
     - Handles refresh failures (re-initiate OAuth flow)

3. **Storage Path Configuration**:
   - **Design Requirement** (line 575): `storagePath?: string` option in OAuth config
   - Not implemented - Option exists in interface but `getStateFilePath()` always uses default `~/.mcp-inspector/oauth/state.json`
   - **Impact**: Users cannot customize OAuth storage location
   - **Proper Solution**:
     - Modify `getOAuthStore()` or `createOAuthStore()` to accept optional `storagePath` parameter
     - Pass `storagePath` from `InspectorClientOptions.oauth?.storagePath` when creating provider
     - Update `getStateFilePath()` to use custom path if provided
     - Ensure storage path is configurable per InspectorClient instance

4. **Resource Metadata Discovery and Selection Testing**:
   - **Design Requirement** (line 43-65): State machine discovers resource metadata and selects resource URL
   - Implemented in state machine but not tested
   - **Impact**: Resource metadata discovery and selection logic is untested
   - **Proper Solution**: Add tests for:
     - Resource metadata discovery from `/.well-known/oauth-protected-resource`
     - Authorization server selection from resource metadata
     - Resource URL selection via `selectResourceURL()`
     - Error handling when resource metadata discovery fails

5. **Scope Discovery Testing**:
   - **Design Requirement** (line 562): "OAuth scope (optional, will be discovered if not provided)"
   - `discoverScopes()` function exists and is used, but not comprehensively tested
   - **Impact**: Scope discovery logic may have edge cases
   - **Proper Solution**: Add tests for:
     - Scope discovery from resource metadata (preferred)
     - Scope discovery from OAuth metadata (fallback)
     - Scope discovery failure handling
     - Scope discovery in both normal and guided modes

6. **Both Redirect URLs Registration Verification**:
   - **Design Requirement** (line 199-207): Both normal and guided redirect URLs should be registered with OAuth server
   - `redirect_uris` getter returns both URLs, but need to verify they're actually registered
   - **Impact**: If both URLs aren't registered, switching between normal/guided modes may fail
   - **Proper Solution**: Add tests that verify both redirect URLs are included in DCR registration

7. **oauthStepChange Event Testing**:
   - **Design Requirement** (line 698-702): `oauthStepChange` event should fire on each step transition
   - Event is dispatched but not tested
   - **Impact**: Event-driven UI updates cannot be verified
   - **Proper Solution**: Add tests that verify:
     - Event fires on each step transition
     - Event includes correct `step`, `previousStep`, and `state` data
     - Event fires for all steps in guided mode

**Review Priority**:

- High: Token refresh, Resource metadata testing
- Medium: Storage path, Scope discovery testing
- Low: Redirect URLs verification, oauthStepChange event testing (partially covered by guided mode tests)

---

## Prioritized Resolution Plan

Remaining work, grouped by priority. Tackle in order; some items can be done in parallel.

### Priority 1: Critical Missing Features (High Impact)

#### 1.1 Token Refresh Support

- **Why**: Important for production use - tokens expire without refresh
- **Effort**: Medium-High
- **Steps**:
  1. Add token expiration checking before requests
  2. Implement automatic refresh using `refresh_token` if expired
  3. Retry original request after refresh
  4. Handle refresh failures (re-initiate OAuth flow)
  5. Add tests for token refresh flow
  6. Test refresh token expiration handling
- **Files**: `shared/mcp/inspectorClient.ts`, `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

### Priority 2: Test Coverage & Code Quality (Medium Impact)

#### 2.1 Resource Metadata Discovery and Selection Testing

- **Why**: Logic is implemented but untested
- **Effort**: Medium
- **Steps**:
  1. Add tests for resource metadata discovery from `/.well-known/oauth-protected-resource`
  2. Test authorization server selection from resource metadata
  3. Test resource URL selection via `selectResourceURL()`
  4. Test error handling when resource metadata discovery fails
- **Files**: `shared/__tests__/auth/state-machine.test.ts`, `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

#### 2.2 Scope Discovery Testing

- **Why**: Function exists but not comprehensively tested
- **Effort**: Low-Medium
- **Steps**:
  1. Add tests for scope discovery from resource metadata (preferred)
  2. Test scope discovery from OAuth metadata (fallback)
  3. Test scope discovery failure handling
  4. Test scope discovery in both normal and guided modes
- **Files**: `shared/__tests__/auth/discovery.test.ts`

#### 2.3 Storage Path Configuration

- **Why**: Option exists but not implemented
- **Effort**: Medium
- **Steps**:
  1. Modify `getOAuthStore()` or `createOAuthStore()` to accept optional `storagePath` parameter
  2. Pass `storagePath` from `InspectorClientOptions.oauth?.storagePath` when creating provider
  3. Update `getStateFilePath()` to use custom path if provided
  4. Ensure storage path is configurable per InspectorClient instance
  5. Add tests for custom storage path
- **Files**: `shared/auth/storage-node.ts`, `shared/mcp/inspectorClient.ts`

#### 2.4 SSE 401 Detection Hack

- **Why**: Works but heuristic could cause false positives
- **Effort**: Medium
- **Steps**:
  1. Investigate if actual HTTP status code is available from error event
  2. If available, use actual status code instead of heuristic
  3. If not available, consider modifying SSE middleware to return proper SSE error stream
  4. Document limitations and workarounds
  5. Add tests for both 401 and legitimate 404 cases
- **Files**: `shared/mcp/inspectorClient.ts`, `shared/test/test-server-http.ts`

#### 2.5 Timer Delays in E2E Tests

- **Why**: Tests work but are fragile
- **Effort**: Low-Medium
- **Steps**:
  1. Replace polling loops with event-driven promises
  2. Use `vi.waitFor()` or similar for async state changes
  3. Remove arbitrary delays
  4. Verify tests are more reliable
- **Files**: `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

#### 2.6 Type Casts: Metadata Property Access

- **Why**: Has TODO comment indicating known issue
- **Effort**: Medium
- **Steps**:
  1. Define proper types for params that include metadata
  2. Create metadata extraction utility with type guards
  3. Remove `as any` casts
  4. Remove TODO comment
- **Files**: `shared/test/test-server-http.ts`, `shared/test/test-server-fixtures.ts`

### Priority 3: Code Quality & Documentation (Low Impact)

#### 3.1 Both Redirect URLs Registration Verification

- **Why**: Should verify both URLs are registered
- **Effort**: Low
- **Steps**:
  1. Add tests that verify both redirect URLs are included in DCR registration
  2. Verify both URLs work for authorization callbacks
- **Files**: `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

#### 3.2 oauthStepChange Event Testing

- **Why**: Event is dispatched but not tested (partially covered by guided mode tests)
- **Effort**: Low
- **Steps**:
  1. Add tests that verify event fires on each step transition
  2. Verify event includes correct `step`, `previousStep`, and `state` data
  3. Verify event fires for all steps in guided mode
- **Files**: `shared/__tests__/inspectorClient-oauth-e2e.test.ts`

#### 3.3 Type Casts: Error Property Access

- **Why**: Loses type safety
- **Effort**: Low-Medium
- **Steps**:
  1. Create proper error type guards (`isErrorWithCode`, `isErrorWithStatus`)
  2. Use discriminated unions for error types
  3. Check for properties before accessing
- **Files**: `shared/mcp/inspectorClient.ts`

#### 3.4 Type Casts: Express Request Extension

- **Why**: Not type-safe
- **Effort**: Low
- **Steps**:
  1. Create TypeScript module augmentation for Express Request
  2. Or use Map/WeakMap to store request-specific data
  3. Or pass token through middleware context/res.locals
- **Files**: `shared/test/test-server-oauth.ts`

#### 3.5 Type Casts: Private Method Access in Tests

- **Why**: Tests access private implementation details
- **Effort**: Low
- **Steps**:
  1. Make `is401Error` a public method if it needs to be tested
  2. Or test indirectly through public methods
  3. Or use TypeScript's `@internal` and proper test utilities
- **Files**: `shared/__tests__/inspectorClient-oauth.test.ts`, `shared/mcp/inspectorClient.ts`

#### 3.6 Type Casts: Global Object Mocking

- **Why**: Common pattern but could be cleaner
- **Effort**: Low
- **Steps**:
  1. Use proper mocking libraries (e.g., `@vitest/spy` or `jsdom`)
  2. Or create proper type declarations for test globals
  3. Ensure proper cleanup in `afterEach`
- **Files**: `shared/__tests__/auth/providers.test.ts`, `shared/__tests__/auth/storage-browser.test.ts`

#### 3.7 Type Casts: Mock Provider Creation

- **Why**: Double cast is a code smell
- **Effort**: Low
- **Steps**:
  1. Use proper mocking library (e.g., `vi.fn()` with full implementation)
  2. Or create a proper test double class that implements the interface
  3. Or use `Partial<BaseOAuthClientProvider>` if partial mocks are acceptable
- **Files**: `shared/__tests__/auth/state-machine.test.ts`

#### 3.8 Documentation: SSE Transport Recreation

- **Why**: Documented in TODO as a "hack" but it's the correct implementation pattern for SSE
- **Effort**: Documentation only
- **Steps**:
  1. Move "SSE Transport Recreation After OAuth" out of this TODO (e.g. to `oauth-inspectorclient-design.md` or implementation notes)
  2. Document that transport recreation after OAuth is required for SSE and is intentional
- **Files**: `docs/authentication-todo.md`, `docs/oauth-inspectorclient-design.md`

### Implementation Order Recommendation

1. **Phase 1** (Critical): 1.1
2. **Phase 2** (Important): 2.1–2.6
3. **Phase 3** (Polish): 3.1–3.8

Many items can be done in parallel (e.g. 2.1–2.3 are test additions).
