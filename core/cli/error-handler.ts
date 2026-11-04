import { redactUrlQuery, redactUrlsInText } from "../mcp/fetchTracking.js";
import { awaitableError } from "./utils/awaitable-log.js";
import { isUnauthorizedError } from "../auth/index.js";
import { SecretStoreUnavailableError } from "../auth/node/secret-store.js";
import { OAuthStateFileUnrecognizedError } from "../auth/node/oauth-persist-file.js";
import { HTTP_TOO_MANY_REQUESTS } from "../mcp/rateLimit.js";

/**
 * Exit-code map. Non-zero codes let an automated caller (CI, an agent) branch
 * on the failure class without regex-scraping stderr:
 *
 *  - 0: success
 *  - 1: usage / unexpected error (the catch-all; same as before this map)
 *  - 2: `--app-info` probe found no MCP App on the tool
 *  - 3: server requires authentication (401 / WWW-Authenticate / OAuth)
 *  - 4: server unreachable (DNS, connect refused, timeout, fetch failure)
 *  - 5: tool error (`tools/call` returned `isError:true`, or tool not found)
 *  - 6: `--strict` found an error-severity tool-schema portability finding
 *  - 7: `--verify` found a SEP-2640 violation
 *  - 8: `--verify` could not check the whole catalog within the read bounds
 *  - 9: `--verify --require-digests` found a skill that advertised no digests
 *  - 10: a `--load` run breached a `--load-max-*` threshold
 *  - 11: the server rate limited the request (HTTP 429)
 *  - 130: a `--load` run was interrupted by Ctrl+C / SIGTERM
 *
 * Note 6 is `SCHEMA_UNPORTABLE`, not "invalid": the whole premise of the lint
 * is that these schemas ARE valid JSON Schema and are merely refused by some
 * clients. Calling the outcome "invalid" would misreport it to the automated
 * callers this map exists for.
 */
export const EXIT_CODES = {
  OK: 0,
  USAGE: 1,
  NO_APP: 2,
  AUTH_REQUIRED: 3,
  UNREACHABLE: 4,
  TOOL_ERROR: 5,
  SCHEMA_UNPORTABLE: 6,
  /**
   * `--verify` found a SEP-2640 violation: a conformance error, a digest or
   * size mismatch, or a manifest file that could not be read (#2248).
   *
   * Its own code rather than reusing `SCHEMA_UNPORTABLE`, for the reason that
   * one exists at all: a CI job that fails on an unportable tool schema and a
   * CI job that fails on a tampered skill digest are different jobs, and
   * collapsing them would make `if [ $? -eq 6 ]` ambiguous.
   */
  SKILL_NONCONFORMANT: 7,
  /**
   * `--verify` could not check the whole catalog: the read bounds stopped the
   * walk before it finished (#2248).
   *
   * Distinct from `SKILL_NONCONFORMANT` because the server has broken no
   * **MUST** — SEP-2640 states the 512-entry and 16 MiB limits as SHOULD NOT,
   * with hosts free to support more — so exiting 7 would call a conforming
   * server nonconformant. It is still non-zero, because reporting success for
   * a manifest whose unread entries were never fetched is a false pass. A CI
   * job that wants to tolerate oversized catalogs can allow 8 and still fail
   * on 7.
   */
  SKILL_INCOMPLETE: 8,
  /**
   * `--verify --require-digests` found a skill whose `resources` is
   * `"dynamic"`, so no digest was advertised and nothing was hashed (#2405).
   *
   * Only ever produced under `--require-digests`: `"dynamic"` is a conforming
   * wire form, and SEP-2640 leaves declining such skills to the host ("Hosts
   * MAY decline to load such skills"). The flag is how a CI job standing in for
   * a host that declines them says so; without it the run exits 0 and reports
   * `outcome: "unverifiable"`. Its own code, like 8, so a job can tell "no
   * digests to check" apart from "a digest was wrong" and "the walk was cut
   * short".
   */
  SKILL_UNVERIFIABLE: 9,
  /**
   * A `--load` run completed and breached a threshold set with
   * `--load-max-error-rate` or `--load-max-p99` (#2745). The summary has
   * already been printed; the envelope `code` names the threshold
   * (`load_error_rate_exceeded` / `load_p99_exceeded`).
   *
   * Not `TOOL_ERROR` (5): a load run's failed calls are measurements, and
   * without a threshold the same run exits 0. Exit 5 from `--load` keeps
   * meaning "the tool was not found", so a CI job can tell "the server missed
   * its SLO" apart from "the job is pointed at the wrong tool".
   */
  LOAD_THRESHOLD_EXCEEDED: 10,
  /**
   * The server answered `429 Too Many Requests` (#2772).
   *
   * Its own code rather than the catch-all, because it is the one failure
   * whose right response is "wait, then run the same command again" — and the
   * envelope says how long, in `retryAfterMs`. Folding it into `1` would leave
   * a script to scrape the prose message to tell throttling from a real error.
   */
  RATE_LIMITED: 11,
  /**
   * A `--load` run was interrupted by SIGINT or SIGTERM (#2834). The partial
   * summary has already been printed, marked `stoppedEarly.reason:
   * "interrupted"`; the envelope `code` is `interrupted`. 130 is the shell's
   * own status for a process ended by SIGINT (128 + 2), so a script sees the
   * same value whether or not the summary got out.
   */
  INTERRUPTED: 130,
} as const;

/** Machine-readable error envelope written as one JSON line on stderr. */
export interface ErrorEnvelope {
  /** Stable identifier for the failure class (e.g. "auth_required"). */
  code: string;
  /** Human-readable message. */
  message: string;
  /** The underlying error's `cause` (e.g. undici's ENOTFOUND), if any. */
  cause?: string;
  /** HTTP status when the failure was an HTTP-level response. */
  status?: number;
  /** The server URL the failure was against, when known. */
  url?: string;
  /**
   * The JSON-RPC method a rate-limited request was for (#2772). This field and
   * the two below are present only on a `rate_limited` envelope, lifted from
   * the error's `AnnotatedRateLimitData` so a caller need not parse `message`.
   */
  method?: string;
  /**
   * The server's `Retry-After` header as sent — verbatim, so a malformed value
   * is still reported. Absent when the server sent none.
   */
  retryAfter?: string;
  /** `retryAfter` as a delay in ms; absent when it did not parse. */
  retryAfterMs?: number;
}

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

/**
 * Thrown by the CLI to request a specific non-zero exit code without routing
 * through the generic error path. {@link formatErrorOutput} reads `exitCode`
 * and `envelope`; the in-process test runner does the same so tests observe
 * the real code and stderr.
 */
export class CliExitCodeError extends Error {
  readonly exitCode: number;
  readonly envelope?: Partial<ErrorEnvelope>;

  constructor(
    exitCode: number,
    message: string,
    envelope?: Partial<ErrorEnvelope>,
  ) {
    super(message);
    this.name = "CliExitCodeError";
    this.exitCode = exitCode;
    this.envelope = envelope;
  }
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
