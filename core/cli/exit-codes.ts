/**
 * The CLI's exit-code map, its error envelope, and the error that carries an
 * exit code, split out of `error-handler.ts` (#2911) so the `--load` engine
 * can import them without dragging that module's Node-only imports (the
 * secret store, the OAuth state file) into the web client, which runs the
 * same engine in the browser. `error-handler.ts` re-exports all three.
 */

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

/**
 * Thrown by the CLI to request a specific non-zero exit code without routing
 * through the generic error path. `formatErrorOutput` (error-handler.ts) reads `exitCode`
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
