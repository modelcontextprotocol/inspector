import {
  ProtocolErrorCode,
  ProtocolError,
  UrlElicitationRequiredError,
} from "@modelcontextprotocol/client";
import type { ElicitRequestURLParams } from "@modelcontextprotocol/client";

export type { ElicitRequestURLParams };

/**
 * Thrown by `callTool` when the URL-elicitation error path would loop: the
 * server's `-32042` retry response re-requests a URL the user already completed
 * earlier in the same call. Completing it again can't make progress, so the
 * call is cancelled instead of re-presenting the same URL. The web layer
 * detects this (over a generic failure) to show a "same URL again" toast.
 */
export class UrlElicitationLoopError extends Error {
  /** The URL the server repeated. */
  readonly url: string;

  constructor(url: string) {
    super(
      `The server asked for the same URL elicitation again (${url}); cancelling the call to avoid a loop.`,
    );
    this.name = "UrlElicitationLoopError";
    this.url = url;
  }
}

/**
 * Detect a `URLElicitationRequiredError` (JSON-RPC code `-32042`) and return the
 * list of URL-mode elicitations the server attached, or `null` when `error` is
 * not that error.
 *
 * Two shapes reach us, both code `-32042`:
 * - the SDK's typed {@link UrlElicitationRequiredError} (created by
 *   `ProtocolError.fromError` when `data.elicitations` is present), and
 * - a generic {@link ProtocolError} with code `-32042` when the server omitted
 *   `data.elicitations` (a non-spec response — the spec requires the list).
 *
 * The empty array is meaningful: it signals the non-spec "no elicitations"
 * case, which the caller surfaces differently (a toast pointing at the raw
 * error) from the spec-compliant case (surface each URL elicitation, then retry
 * the original request). A non-`-32042` error returns `null` so callers fall
 * through to their generic error handling.
 */
export function getUrlElicitationsFromError(
  error: unknown,
): ElicitRequestURLParams[] | null {
  if (error instanceof UrlElicitationRequiredError) {
    return error.elicitations ?? [];
  }
  if (
    error instanceof ProtocolError &&
    error.code === ProtocolErrorCode.UrlElicitationRequired
  ) {
    const data = error.data as
      | { elicitations?: ElicitRequestURLParams[] }
      | undefined;
    return data?.elicitations ?? [];
  }
  return null;
}
