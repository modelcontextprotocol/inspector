/**
 * The web load panel's runtime half (#2911): run the shared `--load` engine
 * (`core/cli/handlers/load-test.ts`, the same one the CLI and mcpdo run) over
 * the browser's live `InspectorClient`.
 *
 * The engine runs here, in the browser, rather than on the web backend. The
 * connection a user is inspecting — its transport, OAuth tokens, custom
 * headers and negotiated era — lives in this tab's `InspectorClient`; the
 * backend only relays its requests. Running the engine there would mean a
 * second connection with its own copy of all of that (and a new `/api/*`
 * route to drive it), and it would measure a session other than the one the
 * user is looking at. Here it reuses the current connection exactly as the
 * CLI's `--load` reuses the one it opened. The cost is that every call also
 * crosses the browser→backend hop the Inspector's own calls do, so the
 * latencies include it; a `--load` run from the CLI does not.
 */
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import {
  runLoadTest,
  type LoadProgress,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { LOAD_TEST_PROGRESS_MS, type LoadTestRequest } from "../utils/loadTest";

/** What a run is told besides its request. */
export interface LoadTestHooks {
  /** Aborting it stops starting calls; in-flight calls settle first. */
  signal: AbortSignal;
  /** Receives a progress report every {@link LOAD_TEST_PROGRESS_MS}. */
  onProgress: (progress: LoadProgress) => void;
}

/** Runs one load test and resolves with its summary. */
export type RunLoadTest = (
  request: LoadTestRequest,
  hooks: LoadTestHooks,
) => Promise<LoadSummary>;

/** Run `request` over `client`, the connection the user is inspecting. */
export function runWebLoadTest(
  client: InspectorClient,
  request: LoadTestRequest,
  hooks: LoadTestHooks,
): Promise<LoadSummary> {
  return runLoadTest(
    client,
    {
      ...(request.toolName !== undefined && { toolName: request.toolName }),
      ...(request.toolArgs !== undefined && { toolArg: request.toolArgs }),
    },
    request.options,
    {
      signal: hooks.signal,
      progress: { everyMs: LOAD_TEST_PROGRESS_MS, emit: hooks.onProgress },
    },
  );
}
