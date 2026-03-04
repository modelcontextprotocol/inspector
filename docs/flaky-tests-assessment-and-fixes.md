# Flaky tests – full assessment and plan

This document covers all four flaky failure modes with root causes and **specific, vetted** fix suggestions. Plan only; no implementation unless requested. Note that these tests have failed once each over thousands of runs.

---

## 1. Streamable HTTP 404 (inspectorClient + pagedResourceTemplatesState)

### What the code does

**Error source (SDK):** `streamableHttp.js` line 364: when a POST gets `!response.ok`, it does `response.text()` and throws `StreamableHTTPError(status, "Error POSTing to endpoint: " + text)`. So the message body we see (HTML or JSON) is the real response body from whoever answered the request.

**Client:** All POSTs use the same URL: `this._url` (set in the constructor, never changed). So the only way to get a 404 is to hit a host/port that returns 404 for that request.

**Test server:** `test-server-http.ts` POST `/mcp` returns 404 only when `transports.get(sessionId)` is null, with `res.status(404).json({ error: "Session not found" })` – i.e. **JSON**, not HTML.

**Conclusion:**

- **HTML 404** → response did **not** come from our test server (our server always returns JSON for 404). So the request hit another server (port reuse or wrong URL).
- **JSON 404 / "Session not found"** → response came from our test server; the session was missing when the request arrived (session lifecycle or wrong server instance).

### Root cause 1: Port reuse + request after teardown

**Mechanism:**

1. Test A: server A on port P, client A with `url = server.url` (port P).
2. Test A ends; afterEach: `disconnect(A)`, `stop(A)` → port P is freed.
3. Test B: `server.start()` with port 0 → OS assigns P. Server B now listens on P.
4. A request from test A’s client (or a callback still holding A’s transport) is sent **after** step 2. It goes to P and is handled by **server B**.
5. Server B does `transports.get(sessionId)` → that session ID is from A, not in B’s map → B returns 404 JSON.
6. If the process that took over P is not our test server (e.g. dev server, other app), we can get an **HTML** 404.

So the flake is either:

- Our test server on a reused port returning “Session not found” (JSON), or
- Another app on that port returning 404 (often HTML).

**Why teardown order isn’t enough:**  
We already do disconnect-then-stop. The problem is a request that is **sent after** disconnect (e.g. reconnection, retry, or a callback that runs later). Once the server is stopped and the port is reused, that request hits the new listener.

### Concrete fixes (Streamable HTTP)

### Fix 1: Distinct 404 body from our test server

**File:** `test-servers/src/test-server-http.ts`  
**Change:** When returning 404 for “Session not found”, use a body that is clearly from this test server, e.g.  
`res.status(404).json({ error: "Session not found", _mcpTestServer: true })`  
or a fixed string like `"SESSION_NOT_FOUND_MCP_TEST"`.  
**Reason:** In the thrown error message we see `response.text()`. If we see that token, the 404 is from our server (session lifecycle). If we see HTML or no token, the 404 is from port reuse / another app. That lets us distinguish the two failure modes and fix the right one.

### Fix 2: Short delay after `server.stop()` in afterEach (streamable HTTP tests)

**Files:** All test files that use the shared afterEach with `server.stop()` (e.g. inspectorClient.test.ts, pagedResourceTemplatesState.test.ts).  
**Change:** After `await server.stop()`, `await new Promise(r => setTimeout(r, 50))` (or 20–50 ms) before the afterEach resolves.  
**Reason:** Gives the OS time to release the port and reduces the chance that a very late request (e.g. from a just-fired callback or retry) still reaches the same port after the next test’s server has bound it. Doesn’t eliminate the race but makes it rarer.

### Fix 3: Optional – run streamable HTTP tests with `--poolOptions.threads=1` or `--sequence`

**File:** `core/vitest.config.ts` (or root vitest config)  
**Change:** For the core project (or a dedicated “http” project), set `pool: 'forks'` and `poolOptions: { threads: 1 }`, or use `sequence: { concurrent: false }` for the suite that contains these tests.  
**Reason:** Ensures one streamable HTTP test runs at a time in that worker, so port assignment and teardown order are deterministic and there’s no cross-test request to a reused port within the same process. Use if Fixes 1–2 are not enough.

### Fix 4: Assert 404 source when we catch the error (optional)

**File:** Tests that use streamable HTTP (or a shared test helper).  
**Change:** When catching `StreamableHTTPError` with status 404, check the message (or parse the body). If it contains the token from Fix 1, fail with “Session not found from our server – session lifecycle bug”. If it contains HTML or not our token, fail with “404 from wrong server – port reuse or wrong URL”.  
**Reason:** Makes the next occurrence of the flake directly tell us which of the two causes it is.

### Summary (Streamable HTTP)

| Fix | Where                              | What                                                                                                                            |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | test-server-http.ts POST /mcp 404  | Return a recognizable body (e.g. `_mcpTestServer: true` or fixed string) so 404s from our server can be told apart from others. |
| 2   | afterEach in streamable HTTP tests | After `await server.stop()`, add `await new Promise(r => setTimeout(r, 50))`.                                                   |
| 3   | vitest config (optional)           | Run streamable HTTP tests with single-thread or sequence so port reuse across tests in the same process is avoided.             |
| 4   | Tests or helper (optional)         | When catching 404, assert or log whether the body is from our server (Fix 1) to classify the failure.                           |

### Recommended order (Streamable HTTP)

1. **First:** Fix 1 (distinct 404 body) – diagnostic; next flake tells us port-reuse vs session lifecycle (if the body appears in the failure output).
2. **If flake continues:** Fix 2 (delay after stop) to reduce port-reuse probability.
3. **If still flaky:** Fix 3 (single-thread/sequence for streamable HTTP tests).
4. **Optional:** Fix 4 (assert on 404 body in tests) for clearer failure messages.

---

## 2. Storage adapter (FileStorageAdapter “creates store and persists state”)

### What the code does

**Test:** `core/__tests__/storage-adapters.test.ts` – creates a store with `createFileStorageAdapter`, sets state (triggers Zustand persist), then waits for the file to exist and asserts content.

**Flow:** `setServerState` → Zustand persist middleware → adapter `setItem` → `writeStoreFile` (core/storage/store-io.ts) → `atomically.writeFile`. Atomically writes to a **temp file** in the same directory (e.g. `test-store.json.tmp-*`), then chmod, then rename to final path. All async.

**Cleanup:** Same describe uses a shared `tempDir`; `afterEach` does `rmSync(tempDir, { recursive: true })` and sets `tempDir = null`. No per-test unique dir.

### Observed failures

- **existsSync(filePath) false** at the assertion (inside `vi.waitFor`) – waitFor times out because the file never appears within the current timeout.
- **Unhandled rejection: ENOENT** on chmod of `test-store.json.tmp-*` – `atomically` is still writing/chmodding the temp file when `afterEach` runs and deletes the whole `tempDir`, so a later step (chmod or rename) sees the file gone.

### Root causes

1. **Persist slower than waitFor window:** Under load (CI, parallel workers), the first persist can take longer than the current `vi.waitFor` timeout (2000 ms). The test then fails with “expected true” / existsSync false.
2. **afterEach runs before persist completes:** The test may finish (e.g. after waitFor passes and assertions run), but a **subsequent** persist (e.g. extra debounced write or another state update) can still be in flight. afterEach runs immediately and `rmSync(tempDir)` removes the directory while atomically is still using a temp file inside it → ENOENT on chmod/rename.

### Concrete fixes (Storage adapter)

**Fix S1: Increase waitFor timeout and interval**

**File:** `core/__tests__/storage-adapters.test.ts`  
**Change:** In both tests that use `vi.waitFor(() => expect(existsSync(filePath)).toBe(true), ...)`, increase `timeout` from 2000 to 5000 and optionally `interval` from 20 to 50.  
**Reason:** Gives persist time to complete under CI/load so the “file never appears” flake is reduced.

**Fix S2: Delay before rmSync in afterEach**

**File:** `core/__tests__/storage-adapters.test.ts`  
**Change:** In afterEach, before `rmSync(tempDir, ...)`, add `await new Promise(r => setTimeout(r, 100))` (and make the afterEach callback `async` if needed, or use a sync delay if the hook doesn’t support async).  
**Reason:** Allows in-flight persist writes (temp file + chmod + rename) to finish before the directory is deleted, reducing ENOENT on the temp file.

**Fix S3: Unique tempDir per test**

**File:** `core/__tests__/storage-adapters.test.ts`  
**Change:** Create `tempDir` in each test (e.g. `mkdtempSync(join(tmpdir(), "inspector-storage-test-"))`) and set it on a variable that afterEach cleans. Already done in each test; ensure afterEach only cleans the current test’s dir and that no test reuses another test’s tempDir. (Currently tempDir is set inside the test and cleared in afterEach, so this is already per-test; the main gain is ensuring we don’t share a dir across tests. If tests run in parallel, use a unique suffix like `Date.now()` or a random id so parallel runs don’t collide.)  
**Reason:** Avoids one test’s cleanup deleting another test’s directory; complements S2 for same-test in-flight write.

**Fix S4 (optional): Flush / close before cleanup**

**File:** Adapter or store API (if we add it), then `core/__tests__/storage-adapters.test.ts`  
**Change:** If we expose a “flush” or “close” that waits for pending writes (e.g. from Zustand persist), call it in afterEach before rmSync.  
**Reason:** Definitive way to avoid ENOENT; requires API surface and possibly changes in how we use persist.

### Recommended order (Storage adapter)

1. **First:** Fix S1 (increase waitFor timeout/interval) – low risk, addresses “file never appears” under load.
2. **Second:** Fix S2 (short delay before rmSync in afterEach) – simple, reduces ENOENT on temp file.
3. **Optional:** Fix S3 if parallel runs share dirs; Fix S4 if we want a robust API for tests.

---

## 3. OAuth E2E (waitForOAuthWellKnown timeout)

### What the code does

**Test:** `core/__tests__/inspectorClient-oauth-e2e.test.ts` – many tests do `server.start()`, then `waitForOAuthWellKnown(serverUrl)` (sometimes twice) before creating the client and running the flow.

**Helper:** `test-servers/src/test-helpers.ts` – `waitForOAuthWellKnown(serverBaseUrl, options)` polls GET `/.well-known/oauth-authorization-server` with default `timeout = 5000`, `interval = 50`, `requestTimeout = 1000`. Each attempt aborts after 1s; throws if no `res.ok` within 5s total.

**Server:** `TestServerHttp` with OAuth enabled calls `setupOAuthRoutes(app, this.config.oauth)` **before** `listen()`. The well-known route is registered at app creation; it’s served as soon as the HTTP server is accepting connections. Listen callback runs when the server is bound; there is no "listening but routes not ready" window.

**Observed flake rate:** This test has passed thousands of times and failed once. Treat as a very rare flake.

### Observed failure

- **waitForOAuthWellKnown timed out after 5000ms: http://localhost:&lt;port&gt;/.well-known/oauth-authorization-server** – every attempt for 5s either threw (connection error, abort) or got non-200.

### We already ensure "server is ready"

We don't assume "listen = ready". `waitForOAuthWellKnown` **is** the readiness check: we poll until we get 200. Same pattern elsewhere: **waitForRemoteStore** (poll GET /api/storage until predicate), **waitForStateFile** (poll file until predicate). So OAuth E2E is already doing the right thing.

### Can a request hang after listen?

No, in this setup:

- Routes are attached before `listen()`. When the listen callback runs, the server is bound and Express will dispatch the next request. A request sent right after `server.start()` either connects and gets a response (possibly slow) or fails to connect (e.g. ECONNREFUSED).
- Each poll attempt is bounded by `requestTimeout` (1s) via AbortController. So no single request can hang for 5s; we retry. The failure is "we never got `res.ok` in 5s across multiple attempts" (connection errors, non-200, or aborts).

So the one-off failure is more consistent with a rare event (wrong URL/port, CI blip, resource contention) than with "server slow to become ready." Increasing the total timeout (5s to 10s) is unlikely to help and would only delay the failure when the server is actually down.

### Concrete fixes (OAuth E2E)

**Fix O1: Better diagnostic when it times out (recommended if it happens again)** **(done)**

**File:** `test-servers/src/test-helpers.ts`  
**Change:** In `waitForOAuthWellKnown`, track the last response status and last error. When throwing the final timeout error, include them in the message (e.g. `lastStatus: ${lastRes?.status}, lastError: ${lastErr?.message}`).  
**Reason:** Next time it fails we can see whether it was connection refused, 404, 500, or repeated aborts – and fix the right cause instead of guessing.

**Fix O2 (optional): Short delay after server.start() before first poll**

**File:** `core/__tests__/inspectorClient-oauth-e2e.test.ts`  
**Change:** After building `serverUrl`, add `await new Promise(r => setTimeout(r, 200));` before `waitForOAuthWellKnown(serverUrl)`.  
**Reason:** Theoretically lets the event loop finish the listen callback before the first fetch; low cost, may reduce an edge case.

**Fix O3 (optional): Use 127.0.0.1 in serverUrl**

**File:** `core/__tests__/inspectorClient-oauth-e2e.test.ts`  
**Change:** Use `const serverUrl = \`http://127.0.0.1:${port}\`;` instead of `localhost`.  
**Reason:** Matches the server’s bind address; avoids any localhost (e.g. IPv6) resolution edge cases.

**Not recommended:** Increasing the 5s total timeout. 5s is already long; a once-in-thousands flake is unlikely to be fixed by 10s, and it only slows the failure when the server is actually down.

### Recommended order (OAuth E2E)

1. **Fix O1 applied:** Timeout error now includes lastStatus and lastError. If it fails again, the message will show what happened.
2. **Optional:** Fix O2 (short delay), Fix O3 (127.0.0.1). Skip increasing the timeout.

---

## 4. Web App – Sampling Reject (inspector-web)

### What the code does

**Test:** `web/src/__tests__/App.samplingNavigation.test.tsx` – “shows sampling request and Reject calls reject”. The test renders the App, clicks Connect, waits for the Sampling tab, dispatches a fake `newPendingSample` event with a `reject` callback (vi.fn()), then finds the Reject button, clicks it, and expects the reject callback to have been called.

**Flow:** The App’s listener adds the request (with the test’s `rejectFn`) to state; the Sampling tab renders `SamplingRequest` with an Approve/Reject button; Reject calls `onReject(request.id)`, which triggers `handleRejectSampling(id)` in App, which finds the request and calls `request.reject(error)`.

### Observed failure

- **AssertionError: expected "vi.fn()" to be called at least once** – `rejectFn` is never invoked before the `waitFor` times out (line 478: `expect(rejectFn).toHaveBeenCalled()`).

### Root causes

1. **Timing:** The test relies on the comment “Handler already set activeTab to sampling” and immediately does `findByRole("button", { name: /Reject/i })` then click. It does **not** wait for the sampling request UI to be in the document (unlike the sibling “Approve” test, which waits for `screen.getByTestId("sampling-request")` before clicking Approve). Under load or slow renders, the Reject button may not yet be wired to this sample’s `reject` callback, or state may not have updated yet, so the click either hits nothing or a different control.
2. **Wrong button:** If another “Reject” exists elsewhere (e.g. another tab or dialog), `findByRole("button", { name: /Reject/i })` could resolve to that button, so the click would not trigger the sampling request’s reject.
3. **waitFor timeout:** The final `waitFor(() => expect(rejectFn).toHaveBeenCalled())` uses the default timeout; if the callback is invoked asynchronously after a slow update, the assertion can time out.

### Concrete fixes (Web Sampling Reject)

**Fix W1: Wait for sampling request before clicking Reject** **(done)**

**File:** `web/src/__tests__/App.samplingNavigation.test.tsx`  
**Change:** After dispatching the sample (the `act` that calls `dispatchNewPendingSample!`), wait for the sampling request container to be in the document before finding and clicking Reject, matching the Approve test. For example:  
`await waitFor(() => { expect(screen.getByTestId("sampling-request")).toBeInTheDocument(); }, { timeout: 3000 });`  
Then find the Reject button, optionally scoped to that container:  
`const rejectButton = within(screen.getByTestId("sampling-request")).getByRole("button", { name: /Reject/i });`  
**Reason:** Ensures the sampling UI and the request (with our `rejectFn`) are rendered and wired before we click; avoids clicking before state has updated or hitting the wrong Reject.

**Fix W2: Scope Reject button to the sampling request container** **(done)**

**File:** `web/src/__tests__/App.samplingNavigation.test.tsx`  
**Change:** Use `within(screen.getByTestId("sampling-request")).getByRole("button", { name: /Reject/i })` (after waiting for `sampling-request` per W1) instead of `screen.findByRole("button", { name: /Reject/i })`.  
**Reason:** Guarantees we click the Reject for this sample, not any other Reject on the page.

**Fix W3 (optional): Longer timeout for rejectFn assertion**

**File:** `web/src/__tests__/App.samplingNavigation.test.tsx`  
**Change:** In the final `waitFor(() => expect(rejectFn).toHaveBeenCalled())`, pass `{ timeout: 3000 }` (or 5000) so a slow async path still passes.  
**Reason:** Reduces flake when the handler runs slightly after the default waitFor window.

### Recommended order (Web Sampling Reject)

1. **First:** Fix W1 (wait for `sampling-request` before clicking Reject) – aligns with the Approve test and removes the main timing race. **(done)**
2. **With W1:** Fix W2 (scope button to `sampling-request`) – ensures we click the correct Reject. **(done)**
3. **Optional:** Fix W3 (longer timeout on the rejectFn assertion) if the flake persists.

---

## Summary table (all flaky areas)

| Area            | Fix | File / location                                              | What                                                                                           |
| --------------- | --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Streamable HTTP | 1   | test-server-http.ts POST /mcp 404                            | Return recognizable 404 body (e.g. `_mcpTestServer: true`).                                    |
| Streamable HTTP | 2   | afterEach in streamable HTTP tests                           | After `await server.stop()`, add ~50 ms delay.                                                 |
| Streamable HTTP | 3   | vitest config (optional)                                     | Single-thread or sequence for streamable HTTP tests.                                           |
| Streamable HTTP | 4   | Tests (optional)                                             | On 404, assert body to classify our server vs other.                                           |
| Storage adapter | S1  | storage-adapters.test.ts                                     | waitFor timeout 2000 → 5000, interval 20 → 50.                                                 |
| Storage adapter | S2  | storage-adapters.test.ts afterEach                           | Short delay (e.g. 100 ms) before rmSync(tempDir).                                              |
| Storage adapter | S3  | storage-adapters.test.ts (optional)                          | Ensure unique tempDir per test (e.g. timestamp/random).                                        |
| OAuth E2E       | O1  | test-helpers.ts                                              | On timeout, include last response status and last error in thrown message (diagnostic). (done) |
| OAuth E2E       | O2  | inspectorClient-oauth-e2e.test.ts (optional)                 | Short delay after server.start() before waitForOAuthWellKnown.                                 |
| OAuth E2E       | O3  | inspectorClient-oauth-e2e.test.ts (optional)                 | Use http://127.0.0.1:${port} for serverUrl.                                                    |
| Web Sampling    | W1  | web/src/**tests**/App.samplingNavigation.test.tsx            | Wait for `sampling-request` in doc before finding/clicking Reject. (done)                      |
| Web Sampling    | W2  | web/src/**tests**/App.samplingNavigation.test.tsx            | Scope Reject button with within(getByTestId("sampling-request")). (done)                       |
| Web Sampling    | W3  | web/src/**tests**/App.samplingNavigation.test.tsx (optional) | Longer timeout on waitFor(rejectFn).toHaveBeenCalled().                                        |

---

## Recommended order (all flakes)

1. **Streamable HTTP:** Apply Fix 1 (distinct 404 body for diagnostics). If flake continues, Fix 2 (delay after stop), then Fix 3 (single-thread/sequence). Optional: Fix 4 (assert on 404 body).
2. **Storage adapter:** Apply Fix S1 (waitFor timeout/interval), then Fix S2 (delay before rmSync). Add S3/S4 if needed.
3. **OAuth E2E:** Fix O1 (diagnostic) applied. Optionally O2 (delay), O3 (127.0.0.1). Do not increase timeout.
4. **Web Sampling Reject:** Fix W1 and W2 applied. Add W3 if still flaky.
