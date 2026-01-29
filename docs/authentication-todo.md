# Authentication TODO

This file tracks **remaining** authentication-related work: temporary workarounds, hacks, missing test coverage, and missing features.

## Remaining E2E Timer Delays

Fixed delays still used in tests. Each is a timer (not an event-driven wait) because no suitable signal exists to wait on. Event-driven helpers (`waitForEvent`, `waitForProgressCount`, `waitForStateFile`, `server.waitUntilRecorded`) have been implemented and deployed; the following are the only remaining delays.

---

### 1. Progress disabled — 200 ms

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **File**     | `shared/__tests__/inspectorClient.test.ts`                                  |
| **Describe** | Progress Tracking                                                           |
| **Test**     | “should not dispatch progressNotification events when progress is disabled” |
| **Line**     | ~1169                                                                       |
| **Code**     | `await new Promise((resolve) => setTimeout(resolve, 200));`                 |

**Why timer, not wait:** We assert that **no** `progressNotification` events are received. You can’t wait for an event that must not happen. The delay is an observation window: we run the tool, wait 200 ms, then assert that no events arrived. A wait would need something like “event X did not fire,” which we don’t have.

---

### 2. listChanged disabled — 200 ms + 200 ms

| Field        | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| **File**     | `shared/__tests__/inspectorClient.test.ts`                           |
| **Describe** | ListChanged Notifications                                            |
| **Test**     | “should respect listChangedNotifications config (disabled handlers)” |
| **Lines**    | ~3254 (first), ~3278 (second)                                        |
| **Code**     | `await new Promise((resolve) => setTimeout(resolve, 200));` (both)   |

**Why timer, not wait:**

- **First 200 ms (after connect):** Let auto-fetch and initial updates settle. There is no explicit “ready” or “initial fetch complete” event to wait on.
- **Second 200 ms (after addTool):** We assert that **no** `toolsChange` is dispatched (handler is disabled). Same as progress disabled: we need an observation window, not a “wait for event,” because the assertion is that the event does **not** occur.

---

### 3. resourceUpdated not subscribed — 100 ms

| Field        | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| **File**     | `shared/__tests__/inspectorClient.test.ts`                               |
| **Describe** | Resource Subscriptions                                                   |
| **Test**     | “should ignore resource updated notification for unsubscribed resources” |
| **Line**     | ~3916                                                                    |
| **Code**     | `await new Promise((resolve) => setTimeout(resolve, 100));`              |

**Why timer, not wait:** We assert that **no** `resourceUpdated` is received for an unsubscribed resource. Again, we’re checking for the absence of an event. The 100 ms is an observation window; there is no “event did not fire” signal to wait on.

---

### 4. Cache timestamp — 10 ms

| Field        | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| **File**     | `shared/__tests__/inspectorClient.test.ts`                 |
| **Describe** | ContentCache integration                                   |
| **Test**     | “should replace cache entry on subsequent calls”           |
| **Line**     | ~2555                                                      |
| **Code**     | `await new Promise((resolve) => setTimeout(resolve, 10));` |

**Why timer, not wait:** We need the clock to advance so the second `readResource` gets a strictly newer `timestamp` than the first. We’re waiting for time to pass, not for an event or API. The only alternative would be fake timers (e.g. `vi.useFakeTimers` + `vi.advanceTimersByTime(10)`).

---

### 5. Async completion callback — 10 ms (in fixture)

| Field        | Value                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------- |
| **File**     | `shared/__tests__/inspectorClient.test.ts` (uses `createFileResourceTemplate` with async callback) |
| **Describe** | Completions                                                                                        |
| **Test**     | “should handle async completion callbacks”                                                         |
| **Line**     | ~2155 (inside fixture callback)                                                                    |
| **Code**     | `await new Promise((resolve) => setTimeout(resolve, 10));`                                         |

**Why timer, not wait:** The delay lives inside the **server fixture’s** async completion callback. It simulates async work (e.g. I/O); the test doesn’t explicitly “wait” for anything. The fixture just sleeps 10 ms before returning. Replacing it would mean changing fixture behavior, not replacing a test wait.

---

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

**Missing/Incomplete Features**: None currently.

---

## Prioritized Resolution Plan

Remaining work, grouped by priority. Tackle in order; some items can be done in parallel.

### Priority 1: Test Coverage & Code Quality (Medium Impact)

#### 1.1 Timer Delays in E2E Tests

- **Status**: Event-driven helpers (`waitForEvent`, `waitForProgressCount`, `waitForStateFile`, `server.waitUntilRecorded`) are implemented and deployed. The **Remaining E2E Timer Delays** section above documents the five fixed delays still in use; each is a timer (not a wait) because no suitable signal exists. No further action unless we adopt fake timers for the cache-timestamp case.
- **Files**: `shared/__tests__/inspectorClient.test.ts`, `shared/test/test-helpers.ts`, `shared/test/test-server-http.ts`

#### 1.2 Type Casts: Metadata Property Access

- **Why**: Has TODO comment indicating known issue
- **Effort**: Medium
- **Steps**:
  1. Define proper types for params that include metadata
  2. Create metadata extraction utility with type guards
  3. Remove `as any` casts
  4. Remove TODO comment
- **Files**: `shared/test/test-server-http.ts`, `shared/test/test-server-fixtures.ts`

### Priority 2: Code Quality & Documentation (Low Impact)

#### 2.1 Type Casts: Error Property Access

- **Why**: Loses type safety
- **Effort**: Low-Medium
- **Steps**:
  1. Create proper error type guards (`isErrorWithCode`, `isErrorWithStatus`)
  2. Use discriminated unions for error types
  3. Check for properties before accessing
- **Files**: `shared/mcp/inspectorClient.ts`

#### 2.2 Type Casts: Express Request Extension

- **Why**: Not type-safe
- **Effort**: Low
- **Steps**:
  1. Create TypeScript module augmentation for Express Request
  2. Or use Map/WeakMap to store request-specific data
  3. Or pass token through middleware context/res.locals
- **Files**: `shared/test/test-server-oauth.ts`

#### 2.3 Type Casts: Global Object Mocking

- **Why**: Common pattern but could be cleaner
- **Effort**: Low
- **Steps**:
  1. Use proper mocking libraries (e.g., `@vitest/spy` or `jsdom`)
  2. Or create proper type declarations for test globals
  3. Ensure proper cleanup in `afterEach`
- **Files**: `shared/__tests__/auth/providers.test.ts`, `shared/__tests__/auth/storage-browser.test.ts`

#### 2.4 Type Casts: Mock Provider Creation

- **Why**: Double cast is a code smell
- **Effort**: Low
- **Steps**:
  1. Use proper mocking library (e.g., `vi.fn()` with full implementation)
  2. Or create a proper test double class that implements the interface
  3. Or use `Partial<BaseOAuthClientProvider>` if partial mocks are acceptable
- **Files**: `shared/__tests__/auth/state-machine.test.ts`

### Implementation Order Recommendation

1. **Phase 1** (Important): 1.1–1.2
2. **Phase 2** (Polish): 2.1–2.4

Many items can be done in parallel.
