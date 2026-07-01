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
 */
export const EXIT_CODES = {
  OK: 0,
  USAGE: 1,
  NO_APP: 2,
  AUTH_REQUIRED: 3,
  UNREACHABLE: 4,
  TOOL_ERROR: 5,
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
}

/**
 * Thrown by the CLI to request a specific non-zero exit code without routing
 * through the generic error path. {@link formatErrorOutput} reads `exitCode`
 * and `envelope`; the in-process test runner does the same so tests observe
 * the real code and stderr.
 */
export class CliExitCodeError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
    public readonly envelope?: Partial<ErrorEnvelope>,
  ) {
    super(message);
    this.name = "CliExitCodeError";
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
  // to the HTTP range (100-599) so a JSON-RPC McpError code (e.g. -32601
  // MethodNotFound) is not mistaken for an HTTP status and leaked into the
  // envelope or misclassified as AUTH_REQUIRED. String node codes like
  // "ENOTFOUND" are already excluded by the numeric check.
  if (typeof e.code === "number" && e.code >= 100 && e.code <= 599) {
    return e.code;
  }
  return undefined;
}

const UNREACHABLE_PATTERN =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|fetch failed|getaddrinfo|connect timed out|aborted/i;

/**
 * Classify an arbitrary error into an exit code and envelope. Used both by the
 * binary's {@link handleError} and by callers that want to throw a
 * {@link CliExitCodeError} with the right code up front.
 */
export function classifyError(
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
      },
    };
  }

  // 401 / OAuth-required → AUTH_REQUIRED so the caller can kick the auth flow.
  if (
    status === 401 ||
    status === 403 ||
    /WWW-Authenticate|Unauthorized|invalid_token|OAuth/i.test(
      message + " " + (cause ?? ""),
    )
  ) {
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

export function handleError(error: unknown): never {
  const { exitCode, stderr } = formatErrorOutput(error);
  process.stderr.write(stderr);
  process.exit(exitCode);
}
