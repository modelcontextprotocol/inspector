/**
 * Guards against a malformed dual `Content-Type` on the OAuth token request
 * made by the direct SSE / Streamable HTTP transports.
 *
 * For direct connections the Inspector passes a `requestInit` to the transport.
 * The SDK wraps it with `createFetchWithInit`, which merges the base
 * `requestInit.headers` with each request's own headers using a case-SENSITIVE
 * object spread. The SDK's token request (executeTokenRequest) builds its
 * headers with `new Headers(...)`, which normalizes the key to lowercase
 * `content-type`.
 *
 * If the Inspector also puts a (capital) `Content-Type` in `requestInit`, both
 * keys survive the case-sensitive merge and `fetch` comma-joins them into
 *   `Content-Type: application/json, application/x-www-form-urlencoded`
 * which strict authorization servers cannot body-parse, breaking token
 * exchange and refresh.
 *
 * The Inspector therefore must not contribute `content-type` (or `accept`) via
 * `requestInit` — the SDK already sets them per request. These tests drive the
 * real SDK merge with the token request's exact shape to lock that in.
 */
import { createFetchWithInit } from "@modelcontextprotocol/sdk/shared/transport.js";

type CapturedRequest = { url: string; contentType: string | null };

/**
 * A fetch that records the `Content-Type` the upstream server would actually
 * receive, using real `Headers` semantics (which combine duplicates).
 */
function makeCapturingFetch(captured: CapturedRequest[]) {
  return (async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => {
    const headers = new Headers(init?.headers);
    captured.push({
      url: typeof input === "string" ? input : input.toString(),
      contentType: headers.get("content-type"),
    });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// Mirrors the SDK's executeTokenRequest: a Headers object, which lowercases the
// key to "content-type", plus a form-urlencoded body.
async function postToken(fetchFn: typeof fetch) {
  await fetchFn("https://auth.example.com/token", {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    }),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "r",
    }),
  });
}

function tokenContentType(captured: CapturedRequest[]): string | null {
  const req = captured.find((c) => c.url.endsWith("/token"));
  expect(req).toBeDefined();
  return req!.contentType;
}

describe("OAuth token request keeps a single Content-Type", () => {
  it("does not duplicate Content-Type when requestInit carries only auth headers", async () => {
    // The headers the Inspector now hands to the transport as
    // `requestInit.headers`: auth / custom headers only, never content-type.
    const captured: CapturedRequest[] = [];
    const fetchFn = createFetchWithInit(makeCapturingFetch(captured), {
      headers: { Authorization: "Bearer test-access-token" },
    });

    await postToken(fetchFn);

    expect(tokenContentType(captured)).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("a Content-Type left in requestInit re-introduces the dual header", async () => {
    // Documents the bug this fix removes: a capital "Content-Type" in
    // requestInit collides with the token request's lowercase "content-type".
    const captured: CapturedRequest[] = [];
    const fetchFn = createFetchWithInit(makeCapturingFetch(captured), {
      headers: { "Content-Type": "application/json" },
    });

    await postToken(fetchFn);

    expect(tokenContentType(captured)).toBe(
      "application/json, application/x-www-form-urlencoded",
    );
  });
});
