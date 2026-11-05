import { redactUrlQuery, redactUrlsInText } from "../mcp/fetchTracking.js";
import { awaitableError } from "./utils/awaitable-log.js";
import { isUnauthorizedError } from "../auth/index.js";
import { SecretStoreUnavailableError } from "../auth/node/secret-store.js";
import { OAuthStateFileUnrecognizedError } from "../auth/node/oauth-persist-file.js";
import { HTTP_TOO_MANY_REQUESTS } from "../mcp/rateLimit.js";

import {
  CliExitCodeError,
  EXIT_CODES,
  type ErrorEnvelope,
} from "./exit-codes.js";

// Moved to `exit-codes.ts` (#2911); re-exported so every existing importer
// keeps working.
export { CliExitCodeError, EXIT_CODES, type ErrorEnvelope };

/** The envelope fields that only a rate-limited failure carries. */
type RateLimitFields = Pick<
  ErrorEnvelope,
  "method" | "retryAfter" | "retryAfterMs"
>;

/**
 * Read the rate-limit fields off an error's `data`, where `annotateRateLimit`
 * (core/mcp/rateLimit.ts) puts them. Each is type-checked rather than trusted,
 * since `data` is an open record on the SDK's error and an unannotated 429
 * carries none of them — a missing field is omitted, never emitted as `null`,
 * matching every other optional envelope field.
 */
function rateLimitFieldsOf(error: unknown): RateLimitFields {
  // Optional chaining covers null/undefined; any other primitive simply has
  // no `data` property.
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (data == null || typeof data !== "object") return {};
  const { method, retryAfter, retryAfterMs } = data as Record<string, unknown>;
  return {
    ...(typeof method === "string" && { method }),
    ...(typeof retryAfter === "string" && { retryAfter }),
    // Finite only: a delta-seconds header too long for a double parses to
    // `Infinity`, which JSON serializes as `null`. The raw header stays.
    ...(typeof retryAfterMs === "number" &&
      Number.isFinite(retryAfterMs) && { retryAfterMs }),
  };
}

/** Depth cap for {@link causeOf} — bounds a pathological/self-referential
 * `error.cause` chain so a cycle can never recurse infinitely. */
const MAX_CAUSE_DEPTH = 16;

/** Read an `Error.cause` chain into a single readable string, if present. */
function causeOf(error: unknown, depth = 0): string | undefined {
  if (depth >= MAX_CAUSE_DEPTH) return undefined;
  if (!(error instanceof Error)) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    const nested = causeOf(cause, depth + 1);
    return nested ? `${cause.message}: ${nested}` : cause.message;
  }
  return String(cause);
}

/** Best-effort HTTP status from common error shapes (undici, MCP SDK, fetch). */
function statusOf(error: unknown): number | undefined {
  if (error == null || typeof error !== "object") return undefined;
  const e = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  if (typeof e.status === "number") return e.status;
  if (typeof e.response?.status === "number") return e.response.status;
  // SDK SseError / StreamableHTTPError expose `.code` as the HTTP status. Guard
  // to the HTTP range (100-599) so a JSON-RPC ProtocolError code (e.g. -32601
  // MethodNotFound) is not mistaken for an HTTP status and leaked into the
  // envelope or misclassified as AUTH_REQUIRED. String node codes like
  // "ENOTFOUND" are already excluded by the numeric check.
  if (typeof e.code === "number" && e.code >= 100 && e.code <= 599) {
    return e.code;
  }
  return undefined;
}

const UNREACHABLE_PATTERN =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|fetch failed|getaddrinfo|connect(?:ion)? timed out|aborted/i;

/**
 * Scrub query-string secrets out of every envelope field that can carry a URL
 * (#2423). The envelope is written verbatim to stderr — a terminal, a CI log,
 * a pipe into another tool — so it gets the same {@link redactUrlQuery}
 * guarantee the web client's Network log and `OAuthRequestTimeoutError`
 * already have: an OAuth `code`, `access_token` or `client_secret` in a server
 * URL is replaced, while the path and non-sensitive parameters stay readable.
 *
 * Applied to the finished envelope rather than to the inputs, so
 * classification still reads the error's own text: redaction rewrites
 * parameter values, and a pattern test run on the rewritten copy could land a
 * different exit code.
 */
function redactEnvelope(envelope: ErrorEnvelope): ErrorEnvelope {
  return {
    ...envelope,
    message: redactUrlsInText(envelope.message),
    ...(envelope.cause !== undefined && {
      cause: redactUrlsInText(envelope.cause),
    }),
    ...(envelope.url !== undefined && { url: redactUrlQuery(envelope.url) }),
    // Kept verbatim when malformed, so it is server text like `message` and
    // can carry a URL just the same (#2772).
    ...(envelope.retryAfter !== undefined && {
      retryAfter: redactUrlsInText(envelope.retryAfter),
    }),
  };
}

/**
 * Classify an arbitrary error into an exit code and envelope. Used both by the
 * binary's {@link handleError} and by callers that want to throw a
 * {@link CliExitCodeError} with the right code up front. Every URL in the
 * returned envelope is query-redacted (see {@link redactEnvelope}).
 */
export function classifyError(
  error: unknown,
  context?: { url?: string },
): { exitCode: number; envelope: ErrorEnvelope } {
  const { exitCode, envelope } = classifyUnredacted(error, context);
  return { exitCode, envelope: redactEnvelope(envelope) };
}

function classifyUnredacted(
  error: unknown,
  context?: { url?: string },
): { exitCode: number; envelope: ErrorEnvelope } {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const cause = causeOf(error);
  const status = statusOf(error);
  const url = context?.url;

  // A pre-classified error carries its own exit code; fill in any envelope
  // fields the thrower didn't supply.
  if (error instanceof CliExitCodeError) {
    return {
      exitCode: error.exitCode,
      envelope: {
        code: error.envelope?.code ?? codeForExit(error.exitCode),
        message,
        ...(cause !== undefined && { cause }),
        ...(error.envelope?.status !== undefined && {
          status: error.envelope.status,
        }),
        ...((error.envelope?.url ?? url) !== undefined && {
          url: error.envelope?.url ?? url,
        }),
        // A rate-limited failure relayed across mcpdo's daemon socket arrives
        // pre-classified, carrying its structured fields on the envelope.
        ...(error.envelope?.method !== undefined && {
          method: error.envelope.method,
        }),
        ...(error.envelope?.retryAfter !== undefined && {
          retryAfter: error.envelope.retryAfter,
        }),
        ...(error.envelope?.retryAfterMs !== undefined && {
          retryAfterMs: error.envelope.retryAfterMs,
        }),
      },
    };
  }

  // Secret-store / OAuth-state-lock failures are operational, not auth: the
  // credentials may well exist but could not be read (keychain unreachable,
  // state file locked by another Inspector process, unreadable secrets
  // file). Reporting them as auth_required would say "re-authorize" for a
  // failure re-authorizing cannot fix. The web path preserves the same
  // distinction as a 503.
  if (error instanceof SecretStoreUnavailableError) {
    return {
      exitCode: EXIT_CODES.USAGE,
      envelope: {
        code: "store_unavailable",
        message,
        ...(cause !== undefined && { cause }),
        ...(url !== undefined && { url }),
      },
    };
  }

  // A present-but-unrecognized OAuth state file also is not an auth
  // failure — the file must be repaired (or deleted), so it gets a code of
  // its own: unlike store_unavailable, retrying will not help.
  if (error instanceof OAuthStateFileUnrecognizedError) {
    return {
      exitCode: EXIT_CODES.USAGE,
      envelope: {
        code: "oauth_state_unrecognized",
        message,
        ...(cause !== undefined && { cause }),
        ...(url !== undefined && { url }),
      },
    };
  }

  // 401/403 or a typed SDK auth error → AUTH_REQUIRED so the caller can kick
  // the auth flow. `isUnauthorizedError` is the same detector cliOAuth.ts
  // uses: `UnauthorizedError.isInstance`, a structured 401 status/code
  // anywhere in the cause chain, and the remote transport's "failed …(401)"
  // wording. Every genuine auth-required condition in the SDK throws typed
  // `UnauthorizedError` or carries a structured 401 — this replaced a
  // keyword sniff (/WWW-Authenticate|Unauthorized|invalid_token|OAuth/i)
  // whose terms matched no real thrower while "OAuth" misclassified
  // ordinary operational errors ("OAuth storage is required…", "HTTP 500
  // trying to load well-known OAuth metadata") as "re-authorize".
  if (status === 401 || status === 403 || isUnauthorizedError(error)) {
    return {
      exitCode: EXIT_CODES.AUTH_REQUIRED,
      envelope: {
        code: "auth_required",
        message,
        ...(cause !== undefined && { cause }),
        ...(status !== undefined && { status }),
        ...(url !== undefined && { url }),
      },
    };
  }

  // 429 → RATE_LIMITED, with the server's retry timing lifted off the
  // annotated error's data so a caller can schedule the retry (#2772).
  // Checked before the unreachable pattern: a throttled request's message
  // embeds the server's response body, which could match it by accident.
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return {
      exitCode: EXIT_CODES.RATE_LIMITED,
      envelope: {
        code: "rate_limited",
        message,
        ...(cause !== undefined && { cause }),
        status,
        ...(url !== undefined && { url }),
        ...rateLimitFieldsOf(error),
      },
    };
  }

  // Network-layer failure → UNREACHABLE so the caller can retry via a proxy.
  if (UNREACHABLE_PATTERN.test(message + " " + (cause ?? ""))) {
    return {
      exitCode: EXIT_CODES.UNREACHABLE,
      envelope: {
        code: "unreachable",
        message,
        ...(cause !== undefined && { cause }),
        ...(status !== undefined && { status }),
        ...(url !== undefined && { url }),
      },
    };
  }

  return {
    exitCode: EXIT_CODES.USAGE,
    envelope: {
      code: "error",
      message,
      ...(cause !== undefined && { cause }),
      ...(status !== undefined && { status }),
      ...(url !== undefined && { url }),
    },
  };
}

function codeForExit(exitCode: number): string {
  switch (exitCode) {
    case EXIT_CODES.NO_APP:
      return "no_app";
    case EXIT_CODES.AUTH_REQUIRED:
      return "auth_required";
    case EXIT_CODES.UNREACHABLE:
      return "unreachable";
    case EXIT_CODES.TOOL_ERROR:
      return "tool_error";
    case EXIT_CODES.SCHEMA_UNPORTABLE:
      return "schema_unportable";
    case EXIT_CODES.RATE_LIMITED:
      return "rate_limited";
    default:
      return "error";
  }
}

/**
 * Single source of truth for mapping a thrown error to the CLI's exit code and
 * stderr text. The binary entry ({@link handleError}) and the in-process test
 * runner both call this, so tests observe exactly what the binary would emit.
 *
 * stderr is one JSON line `{"error":{...}}` so a caller can `2>&1 | tail -1 |
 * jq .error`; the message is inside the envelope so nothing is lost vs. the
 * previous bare-message behaviour.
 */
export function formatErrorOutput(
  error: unknown,
  context?: { url?: string },
): { exitCode: number; stderr: string } {
  const { exitCode, envelope } = classifyError(error, context);
  return {
    exitCode,
    stderr: JSON.stringify({ error: envelope }) + "\n",
  };
}

/**
 * The binary's last-resort error sink: write the envelope, then exit.
 *
 * **Async, and the await is load-bearing.** On a pipe or a file — as opposed
 * to a TTY — `process.stderr.write` is asynchronous, and `process.exit()`
 * discards whatever is still queued. Size is not the safeguard it looks like:
 * the envelope being small enough for the pipe buffer says nothing about
 * whether the write has been *performed* by the time the process goes away.
 * So this settles on the write callback first, exactly as the `--strict`
 * schema report does.
 */
export async function handleError(error: unknown): Promise<never> {
  const { exitCode, stderr } = formatErrorOutput(error);
  await awaitableError(stderr);
  process.exit(exitCode);
}
