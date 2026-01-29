# E2E Timer Delays – Review and Recommendations

This document reviews timer-based waits and polling in E2E tests and recommends event-driven or other alternatives where possible. It was written for the _Timer Delays in E2E Tests_ item in `authentication-todo.md` (initially scoped to `inspectorClient-oauth-e2e.test.ts`) but also covers `inspectorClient.test.ts`, `inspectorClient-oauth.test.ts`, and `auth/storage-node.test.ts` for a complete picture.

---

## 1. `inspectorClient-oauth-e2e.test.ts`

### 1.1 Storage path test – `vi.waitFor` (polling for state file)

**Location**: “Storage path (custom)” → “should persist OAuth state to custom storagePath” (lines ~989–1002)

**Current pattern**: `vi.waitFor` polls until the OAuth state file exists at `customPath` and contains expected `servers[*].tokens` (timeout 2000ms, interval 50ms).

**What we’re waiting for**: Zustand persist middleware writes to disk asynchronously after `saveTokens` / OAuth flow. There is no API that signals “persist write complete.”

**Recommendation**:

- **Keep `vi.waitFor`** for this case. Polling the file is the only practical option without changing the storage layer.
- **Optional improvement**: Introduce a small test helper, e.g. `waitForStateFile(path, predicate)`, used by both `storage-node.test` and this E2E test, to avoid duplicating the same polling logic.
- **Alternative (larger change)**: Add a test-only hook in the persist storage adapter (e.g. `onAfterSetItem`) that resolves a promise or emits when `setItem` completes, and expose it only in test. Then we could `await` that instead of polling. This adds moving parts and test-only code paths.

---

## 2. `auth/storage-node.test.ts`

### 2.1 “should persist state to file” – `vi.waitFor`

**Location**: NodeOAuthStorage describe (lines ~393–404)

**Current pattern**: Same as above – poll the default state file until it contains the expected `clientInformation` for a server.

**Recommendation**: Same as 1.1 – **keep `vi.waitFor`**, optionally share a helper with the E2E storage-path test.

### 2.2 “should use custom path for state file” – `vi.waitFor`

**Location**: “NodeOAuthStorage with custom storagePath” (lines ~425–434)

**Current pattern**: Same – poll `customPath` until it has the expected tokens.

**Recommendation**: Same as 1.1 and 2.1.

---

## 3. `inspectorClient-oauth.test.ts`

### 3.1 “should dispatch oauthAuthorizationRequired when authenticating” – `setTimeout` (timeout guard)

**Location**: Lines ~146–175

**Current pattern**: `Promise` that resolves when `oauthAuthorizationRequired` fires, or rejects after 5s via `setTimeout` if the event never fires. The timeout is cleared when the event is received.

**What we’re waiting for**: The `oauthAuthorizationRequired` event from `authenticate()`.

**Recommendation**:

- **Replace with `vi.waitFor`** (or a small helper) that:
  - Collects the event in a listener.
  - Runs a predicate each tick (e.g. “event received”).
  - Resolves when the predicate passes, or throws when the timeout is hit.
- **Alternatively**, use a dedicated “wait for event” helper, e.g. `waitForEvent(client, 'oauthAuthorizationRequired', { timeout: 5000 })`, implemented via a one-off listener + `Promise.race` with a timeout promise. The important change is to **standardize** on a single pattern (e.g. `waitForEvent`) instead of ad-hoc `setTimeout` + `addEventListener` + `clearTimeout`.
- The **signal** stays the same: **`oauthAuthorizationRequired` event**. No new APIs needed.

### 3.2 “should dispatch oauthError event when OAuth flow fails” – `setTimeout` (timeout guard)

**Location**: Lines ~210–235

**Current pattern**: Same as 3.1, but waiting for `oauthError` and 3s timeout.

**Recommendation**: Same as 3.1 – use **`waitForEvent(client, 'oauthError', { timeout: 3000 })`** (or equivalent). Signal: **`oauthError` event**.

---

## 4. `inspectorClient.test.ts`

### 4.1 Progress notifications – `setTimeout(200)` after `callTool("sendProgress", …)`

**Locations**:

- “should dispatch progressNotification events when progress token in metadata” (~1101)
- “should not dispatch progressNotification events when progress is disabled” (~1181)
- “Indeterminate progress” variant (~1238)

**Current pattern**: Call `sendProgress` with `delayMs: 50`, then `await new Promise(resolve => setTimeout(resolve, 200))` before asserting on `progressNotification` events.

**What we’re waiting for**: All progress notifications for that tool call to be received. The tool sends multiple progress updates, each after `delayMs`.

**Recommendation**:

- **Wait on progress events instead of a fixed delay.** Options:
  1. **Count-based**: Use a `progressNotification` listener that resolves a promise once `progressEvents.length` reaches the expected count (e.g. `units` or 2 for indeterminate). Then `await` that promise instead of `setTimeout(200)`.
  2. **`vi.waitFor`**: Poll `progressEvents.length === expected` with a short interval and a sensible timeout (e.g. 2s). Less ideal than (1) but still better than a blind 200ms.
- **Signal**: **`progressNotification`** events. No new APIs.

### 4.2 Roots `list_changed` notification – polling loop + 10ms delays

**Location**: “should send roots/list_changed notification when roots are updated” (~1945–1954)

**Current pattern**: After `setRoots(newRoots)`, loop up to 50 times, each time calling `server.getRecordedRequests()`, looking for `notifications/roots/list_changed`. Between iterations, `await new Promise(resolve => setTimeout(resolve, 10))`.

**What we’re waiting for**: The **server** to have recorded the `notifications/roots/list_changed` request. The client sends it asynchronously; the test observes via the server’s recorded requests.

**Recommendation**:

- **Introduce a server-side “wait until recorded” API**, e.g. `server.waitUntilRecorded(predicate, { timeout })` that returns a Promise resolved when a recorded request matches `predicate`, or rejects on timeout. Implement it with `vi.waitFor`-style polling over `getRecordedRequests()` (or equivalent) so we replace the hand-rolled loop + 10ms sleeps with a single `await server.waitUntilRecorded(...)`.
- **Signal**: **Server recorded a request** matching the predicate. The “event” is “request X appeared in recorded requests.”

### 4.3 Roots `rootsChange` event – `setTimeout(100)` after second `setRoots`

**Location**: Same test (~1981)

**Current pattern**: `setRoots` again, then `await new Promise(resolve => setTimeout(resolve, 100))`, then `await rootsChangePromise` (from a `rootsChange` listener).

**What we’re waiting for**: The `rootsChange` event.

**Recommendation**:

- **Remove the 100ms delay.** We already wait on `rootsChangePromise`. The event should fire when `setRoots` updates state; we can `await client.setRoots(...)` then immediately `await rootsChangePromise`. If the event is emitted synchronously, the promise may already be resolved.
- **Signal**: **`rootsChange`** event only. No extra delay.

### 4.4 `listChangedNotifications` disabled – `setTimeout(200)` before/after

**Locations**:

- “should not run list changed notification handlers when disabled” (~3293): 200ms after connect “for autoFetch… and events to settle,” then 200ms after `callTool("addTool", ...)` “to see if notification handler runs.”

**Current pattern**: Fixed delays to allow auto-fetch and notification handling to settle.

**What we’re waiting for**:  
(1) Auto-fetch and initial updates to settle after connect.  
(2) Enough time for a hypothetical `list_changed` handler to run (we expect it **not** to run).

**Recommendation**:

- **First delay (after connect):** Prefer an **explicit settlement signal** instead of 200ms, if one exists. For example, wait for a `statusChange` to `"connected"` and/or for `toolsChange` (or similar) from auto-fetch, if the client exposes that. If there is no such event, we could add a small `connect`-related “ready” hook for tests, or keep a **short** delay but document why (e.g. “allow initial fetch to settle”) and consider `vi.waitFor` on “tools fetched” if we can detect it.
- **Second delay (after addTool):** We’re asserting that **no** `toolsChange` runs. We can’t wait for an event that must not occur. Options:
  - **`vi.waitFor`** that checks “still no `toolsChange`” over a short window (e.g. 200–500ms), then asserts `eventReceived === false`. That at least replaces a blind delay with “wait a bounded time while checking.”
  - **Keep a small fixed delay** as a “observation window” and document it, but reduce it if 200ms is overly conservative.
- **Signal**: Connect/auto-fetch settlement (if available); otherwise “no event in observation window.”

### 4.5 `resourceUpdated` when not subscribed – `setTimeout(100)` after `callTool("updateResource", ...)`

**Location**: “should not dispatch resourceUpdated when resource not subscribed” (~3955)

**Current pattern**: 100ms delay after `updateResource` before asserting `resourceUpdated` was **not** received.

**What we’re waiting for**: Enough time for a hypothetical `resourceUpdated` to fire (we expect it not to).

**Recommendation**: Same idea as 4.4’s second delay – **`vi.waitFor`** over a short “observation window” (e.g. 100–200ms) that repeatedly checks “still no `resourceUpdated`,” then assert. Alternatively, keep a small fixed delay as the observation window, but document it.

### 4.6 Task failure – `setTimeout(200)` after `callToolStream` rejects

**Location**: “should handle task failure and dispatch taskFailed event” (~4325)

**Current pattern**: `callToolStream("failingTask", …)` rejects; we then `setTimeout(200)` before asserting `taskFailed` was dispatched.

**What we’re waiting for**: The `taskFailed` event, which is emitted asynchronously when the task fails.

**Recommendation**:

- **Wait for the event**, not a fixed delay. Use `waitForEvent(client, 'taskFailed', { timeout: 2000 })` (or equivalent). The stream rejection and the event are related but not the same; the test cares about the event.
- **Signal**: **`taskFailed`** event.

### 4.7 Task cancel – “wait for task to be created” then “wait for cancellation”

**Location**: “should cancel a running task” (~4377, 4388)

**Current pattern**:  
(1) `callToolStream("longRunningTask", …)`, then `setTimeout(100)` “for task to be created.”  
(2) `cancelTask(taskId)`, then `setTimeout(200)` “for cancellation to complete.”

**What we’re waiting for**:  
(1) Task to exist (so we can get `taskId` and cancel it).  
(2) Cancellation to complete (task status `cancelled`).

**Recommendation**:

- **“Task created”:** Wait for **`taskCreated`** (or equivalent) event, or **`vi.waitFor`** on `client.getClientTasks().length > 0` and then read `taskId`. Prefer the event if we have it.
- **“Cancellation complete”:** Wait for **`taskCancelled`** event, or **`vi.waitFor`** on `(await client.getTask(taskId)).status === 'cancelled'`. Prefer the event.
- **Signals**: **`taskCreated`**, **`taskCancelled`** (or task status).

### 4.8 Elicitation – `Promise.race` with `setTimeout` timeout

**Location**: “should handle elicitation with task (input_required flow)” (~4449–4458)

**Current pattern**: `Promise.race([elicitationPromise, new Promise((_, reject) => setTimeout(..., 2000))])` to avoid waiting forever for the elicitation request.

**What we’re waiting for**: The elicitation request (or timeout).

**Recommendation**: **Keep the race-with-timeout pattern**; it’s appropriate. Standardize the implementation (e.g. `waitForEvent` or `waitForEventWithTimeout`) so we don’t duplicate ad-hoc `setTimeout` reject logic. **Signal**: whatever event carries the elicitation (e.g. `elicitationRequest` or similar).

### 4.9 Sampling – `Promise.race` with `setTimeout` + 100ms delay

**Location**: “should handle sampling with task (input_required flow)” (~4526–4539)

**Current pattern**: Same as 4.8 for sampling (`newPendingSample`), plus `setTimeout(100)` “for task to be created” before inspecting `getClientTasks()`.

**Recommendation**:

- **Timeout in `Promise.race`**: Same as 4.8 – keep it, standardize.
- **100ms “task created” delay**: Same as 4.7 – replace with **`taskCreated`** or **`vi.waitFor`** on `getClientTasks().length > 0`. **Signal**: **`taskCreated`** or task list update.

### 4.10 Progress linked to tasks – 2500ms delay

**Location**: “should handle progress notifications linked to tasks” (~4652–4653)

**Current pattern**: After setting up `taskCreated` / `progressNotification` / `taskCompleted` listeners and starting the task, we `setTimeout(2500)` (delayMs 2000 + 500ms buffer) before awaiting the result promise. Progress is sent at ~400ms intervals.

**What we’re waiting for**: All progress notifications (and optionally task completion) before we assert on progress events and result.

**Recommendation**:

- **Wait on events, not time.** For example:
  1. **`taskCompleted`**: `await waitForEvent(client, 'taskCompleted', { timeout: 5000 })` (or await the `resultPromise`, which already implies completion).
  2. **Progress count**: Same as 4.1 – resolve a promise when we’ve received the expected number of `progressNotification` events (e.g. 5), then assert.
- **Avoid** the 2500ms delay; use **`taskCompleted`** (or result promise) + **progress count** as signals. The result promise already “waits for task to complete”; we only need to ensure we’ve also collected all progress events (via count-based wait) before asserting.

### 4.11 `listTasks` pagination – `setTimeout(500)` before `listTasks`

**Location**: “should handle listTasks pagination” (~4735)

**Current pattern**: Create several tasks with `callToolStream("simpleTask", …)`, then `setTimeout(500)` “for tasks to complete,” then `listTasks()`.

**What we’re waiting for**: Tasks to complete so `listTasks` returns them.

**Recommendation**:

- **Await completion explicitly:** For each `callToolStream("simpleTask", …)`, `await` the returned promise (or use `Promise.all`). Then no delay is needed before `listTasks`.
- **Signal**: **Completion of each tool-stream promise.** No new APIs.

### 4.12 Cache “different timestamp” – `setTimeout(10)`

**Location**: “should replace cache entry on subsequent calls” (~2594)

**Current pattern**: `readResource` twice; between calls, `setTimeout(10)` “to ensure different timestamp.”

**What we’re waiting for**: Time to pass so the next `readResource` gets a newer `timestamp`.

**Recommendation**: **Keep a small delay** (10ms is fine); the strict “event” would be “clock tick,” which we don’t expose. Alternatively, **inject a fake clock** (e.g. `vi.useFakeTimers()`) and `vi.advanceTimersByTime(10)` between calls, then avoid real wall-clock wait. **Signal**: time advancement (real or fake).

### 4.13 Async completion callback – `setTimeout(10)` inside fixture

**Location**: “should handle async completion callbacks” (~2194)

**Current pattern**: The **server** fixture’s async completion callback does `await new Promise(resolve => setTimeout(resolve, 10))` to “simulate async operation.”

**What we’re waiting for**: Simulated async work inside the server.

**Recommendation**: This is **fixture behavior**, not a test delay. We can leave it as-is, or shorten it (e.g. 1ms) if we only need “async” semantics. No change to test structure required.

---

## 5. Summary table

| File            | Location                       | Current                         | Recommended signal / change                                                                  |
| --------------- | ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- |
| oauth-e2e       | Storage path test              | `vi.waitFor` (file poll)        | Keep; optional shared helper                                                                 |
| storage-node    | Persist-state tests            | `vi.waitFor` (file poll)        | Keep; optional shared helper                                                                 |
| oauth (unit)    | oauthAuthorizationRequired     | `setTimeout` timeout guard      | `waitForEvent(client, 'oauthAuthorizationRequired')`                                         |
| oauth (unit)    | oauthError                     | `setTimeout` timeout guard      | `waitForEvent(client, 'oauthError')`                                                         |
| inspectorClient | Progress (sendProgress)        | `setTimeout(200)`               | Wait on N× `progressNotification` (count-based or `vi.waitFor`)                              |
| inspectorClient | Roots list_changed             | Loop + 10ms sleeps              | `server.waitUntilRecorded(predicate)`                                                        |
| inspectorClient | Roots rootsChange              | `setTimeout(100)`               | Remove; wait only on `rootsChange`                                                           |
| inspectorClient | listChanged disabled           | 200ms + 200ms                   | Settle via connect/auto-fetch if possible; “no event” window via `vi.waitFor` or short delay |
| inspectorClient | resourceUpdated not subscribed | 100ms                           | “No event” window via `vi.waitFor` or short delay                                            |
| inspectorClient | taskFailed                     | 200ms                           | `waitForEvent(client, 'taskFailed')`                                                         |
| inspectorClient | Task cancel                    | 100ms + 200ms                   | `taskCreated` then `taskCancelled` (or status poll)                                          |
| inspectorClient | Elicitation                    | `Promise.race` + 2s timeout     | Keep pattern; standardize helper                                                             |
| inspectorClient | Sampling                       | `Promise.race` + 3s, then 100ms | Keep race; replace 100ms with `taskCreated` / task-list wait                                 |
| inspectorClient | Progress linked to tasks       | 2500ms                          | `taskCompleted` + progress-count wait                                                        |
| inspectorClient | listTasks pagination           | 500ms                           | `await` each `callToolStream` result                                                         |
| inspectorClient | Cache timestamp                | 10ms                            | Keep or use fake timers                                                                      |
| inspectorClient | Async completion (fixture)     | 10ms in server                  | Optional: reduce; fixture-only                                                               |

---

## 6. Suggested helpers

Implementing these would reduce duplication and make “wait for X” explicit:

1. **`waitForEvent(target, eventName, { timeout })`**  
   Returns a Promise that resolves with the event detail when the event fires, or rejects after `timeout`. Use for `oauthAuthorizationRequired`, `oauthError`, `taskFailed`, `taskCancelled`, `taskCreated`, `taskCompleted`, `rootsChange`, etc.

2. **`waitForProgressCount(client, expectedCount, { timeout })`**  
   Resolves when `progressNotification` has been received `expectedCount` times. Use for sendProgress and progress-linked-to-tasks tests.

3. **`server.waitUntilRecorded(predicate, { timeout })`**  
   Returns a Promise resolved when `getRecordedRequests()` has an entry matching `predicate`, or rejects on timeout. Use for roots `list_changed` and similar “server saw request” cases.

4. **`waitForStateFile(path, predicate, { timeout })`** (optional)  
   Wraps `vi.waitFor`-style polling of the state file. Use for storage-node and storage-path E2E tests.

Use of **`vi.waitFor`** remains appropriate for “poll until predicate” cases (files, server recordings, “no event in window”) where no direct event or API exists.
