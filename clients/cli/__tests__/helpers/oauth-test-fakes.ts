import { vi } from "vitest";
import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { CliOAuthClient } from "../../src/cliOAuth.js";

/**
 * Typed mock factories for the CLI OAuth tests. They exist so a test can supply
 * only the surface a given code path exercises while `tsc` still sees a
 * complete `CliOAuthClient` / `InspectorServerSettings` — avoiding a spray of
 * `as unknown as` casts (see #1791 and the AGENTS.md `as`-cast policy).
 */

/**
 * A full {@link CliOAuthClient} whose every method is a `vi.fn()` resolving to a
 * benign value. Pass `overrides` to swap in the method(s) a test drives (e.g. a
 * `connect` that rejects with `AuthRecoveryRequiredError`).
 */
export function makeFakeCliOAuthClient(
  overrides: Partial<CliOAuthClient> = {},
): CliOAuthClient {
  // The defaults are typed against the real CliOAuthClient signatures (not bare
  // vi.fn()s) so a default with a wrong implementation/return would be rejected,
  // the same way the tui App spies are typed. Note this does NOT extend to
  // `overrides`: a caller passing a bare `vi.fn()` gets `Mock<(...args) => any>`,
  // assignable to any member, so an override's implementation is unchecked — the
  // factory guarantees the object's shape, not each override's signature. (And
  // since `exactOptionalPropertyTypes` is off, `Partial<…>` even admits an
  // explicit `undefined` for a required member.)
  return {
    connect: vi.fn<CliOAuthClient["connect"]>().mockResolvedValue(undefined),
    disconnect: vi
      .fn<CliOAuthClient["disconnect"]>()
      .mockResolvedValue(undefined),
    authenticate: vi
      .fn<CliOAuthClient["authenticate"]>()
      .mockResolvedValue(undefined),
    beginInteractiveAuthorization: vi
      .fn<CliOAuthClient["beginInteractiveAuthorization"]>()
      .mockResolvedValue(undefined),
    completeOAuthFlow: vi
      .fn<CliOAuthClient["completeOAuthFlow"]>()
      .mockResolvedValue(undefined),
    checkAuthChallengeSatisfied: vi
      .fn<CliOAuthClient["checkAuthChallengeSatisfied"]>()
      .mockResolvedValue(false),
    ...overrides,
  };
}

/**
 * A full {@link InspectorServerSettings} with representative defaults for its
 * required fields (the timeouts at 0 = "SDK default", `taskTtl` /
 * `maxFetchRequests` at their product defaults, empty lists elsewhere). Pass
 * `overrides` for the field(s) under test (e.g. `{ enterpriseManaged: true }`);
 * as a `Partial<…>` with `exactOptionalPropertyTypes` off it also admits an
 * explicit `undefined` for a required field, so don't rely on it to reject one.
 */
export function makeFakeServerSettings(
  overrides: Partial<InspectorServerSettings> = {},
): InspectorServerSettings {
  return {
    headers: [],
    metadata: [],
    env: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
    roots: [],
    ...overrides,
  };
}
