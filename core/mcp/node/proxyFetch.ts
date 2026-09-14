import type {
  Dispatcher,
  RequestInit as UndiciRequestInit,
  Response as UndiciResponse,
} from "undici";

/**
 * The undici and DOM declarations of `RequestInit` / `BodyInit` describe the
 * same wire contract; they differ only in *which realm's* `ReadableStream`,
 * `Blob`, and `Headers` types they name, and TypeScript cannot relate two `lib`
 * sets' structurally-identical stream types (their `pipeThrough` signatures
 * differ in variance alone). At runtime there is one implementation — undici
 * consumes exactly the values Node's own `fetch` does — so these two casts
 * bridge a declaration gap rather than a real type difference, and they are kept
 * to this one module boundary instead of leaking into callers.
 */
function asUndiciInit(init: RequestInit | undefined): UndiciRequestInit {
  return init as UndiciRequestInit;
}

/** See {@link asUndiciInit} — same declaration gap, opposite direction. */
function asBodyInit(body: UndiciResponse["body"]): BodyInit | null {
  return body as BodyInit | null;
}

/** Standard proxy env vars, in the precedence undici's EnvHttpProxyAgent uses. */
const PROXY_ENV_VARS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
] as const;

/**
 * First proxy URL found in the environment, or `undefined` if none is set.
 * Exported for tests and so callers can decide whether proxying is in effect.
 */
export function readProxyEnv(): string | undefined {
  for (const name of PROXY_ENV_VARS) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Statuses for which the `Response` constructor rejects a non-null body.
 *
 * undici already returns a null body for these, so the guard is belt-and-braces
 * — but a `Response` constructor throwing inside the adapter would surface as an
 * opaque failure of the request itself, which is a bad trade for one `Set`.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

/**
 * Re-wraps an undici `Response` as a *global* one, preserving streaming.
 *
 * This is not ceremony. Userland undici's `Response` is a different class from
 * `globalThis.Response`, so `res instanceof Response` is `false` for it — and the
 * SDK branches on exactly that: `parseErrorResponse` (in
 * `@modelcontextprotocol/client`) reads `input instanceof Response ? await
 * input.text() : input`, so an undici response falls into the string branch and
 * every OAuth error degrades to `Raw body: [object Response]`. Handing back a
 * genuine global `Response` keeps every consumer on the class it tests for.
 *
 * The body passes through as a `ReadableStream` rather than being buffered, so
 * SSE responses (the streamable-HTTP transport's whole event channel) still
 * stream.
 *
 * `url`, `redirected`, and `type` are restored afterwards with
 * `defineProperty`, because the `Response` constructor cannot set them and a
 * rebuilt response would otherwise report `url: ""` and `redirected: false`
 * even after undici followed a redirect — a fetch-contract regression visible
 * only to proxy users. `core/auth/endpointOverrides.ts` guards the same three
 * properties by declining to rebuild at all; this adapter has no such choice,
 * since the response arrives from the wrong realm, so it reinstates them
 * instead. They shadow the prototype getters as own properties, which is what
 * `Response` exposes them as to a consumer.
 */
function toGlobalResponse(res: UndiciResponse): Response {
  const headers = new Headers();
  for (const [key, value] of res.headers) headers.append(key, value);
  const out = new Response(
    NULL_BODY_STATUSES.has(res.status) ? null : asBodyInit(res.body),
    {
      status: res.status,
      statusText: res.statusText,
      headers,
    },
  );
  for (const [key, value] of [
    ["url", res.url],
    ["redirected", res.redirected],
    ["type", res.type],
  ] as const) {
    Object.defineProperty(out, key, {
      value,
      configurable: true,
      enumerable: false,
    });
  }
  return out;
}

/**
 * Loads userland undici and binds its `fetch` to an `EnvHttpProxyAgent`.
 *
 * Both halves of that pair must come from the *same* undici. Injecting a
 * userland dispatcher into Node's built-in `fetch` — what this module used to do
 * — couples the two undici copies at the dispatcher handler interface, which is
 * not stable across majors: Node 22 ships undici 6, Node 24 ships 7, Node 26
 * ships 8, so a userland undici 8 agent handed a built-in undici 7 handler is
 * rejected with `invalid onRequestStart method` and the request never leaves the
 * process (#2067). Using undici's own `fetch` keeps the handler on both sides of
 * the call inside one copy, which is why it works unchanged from the Node 22.19
 * engine floor through Node 26.
 */
/**
 * Process-wide, so every client shares one `EnvHttpProxyAgent` and therefore one
 * connection pool. The memo is deliberately not per-`createProxyFetch()` call:
 * the TUI builds an environment per configured server, and a pool each would
 * multiply sockets against the proxy for no benefit.
 */
let loadedProxiedFetch: Promise<typeof fetch> | undefined;

async function loadProxiedFetch(): Promise<typeof fetch> {
  let undici: typeof import("undici");
  try {
    undici = await import("undici");
  } catch (cause) {
    throw new Error(
      "HTTPS_PROXY / HTTP_PROXY is set but the `undici` package could not be " +
        "loaded, so requests cannot be routed through the proxy. This is a " +
        "packaging fault rather than something to fix by installing undici; " +
        "please report it, or unset the proxy env var to fall back to a direct " +
        "connection.",
      { cause },
    );
  }

  const dispatcher: Dispatcher = new undici.EnvHttpProxyAgent();
  return async (input, init) => {
    const [target, requestInit] = toUndiciRequest(input, init);
    return toGlobalResponse(
      await undici.fetch(target, { ...asUndiciInit(requestInit), dispatcher }),
    );
  };
}

/**
 * Normalizes fetch's `input`/`init` pair into something undici's `fetch` accepts.
 *
 * undici builds its own `Request` from `input`, and its constructor cannot
 * consume a *global* `Request` — it would stringify it to `"[object Request]"`
 * and request that as a URL. Every call site in this repo and in the SDK passes
 * a string or `URL` today, so the unpacking branch is defensive; without it a
 * future caller passing a `Request` would fail in a way that looks like a
 * network error rather than a type mismatch.
 */
function toUndiciRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): [string, RequestInit] {
  if (input instanceof Request) {
    return [
      input.url,
      {
        method: input.method,
        headers: input.headers,
        // A stream body needs `duplex: "half"`; the field is undici's, not in
        // the DOM `RequestInit`, so it rides along as an extra property.
        ...(input.body ? { body: input.body, duplex: "half" } : {}),
        signal: input.signal,
        // Everything else the Request carries. Dropping these would silently
        // change fetch semantics under a proxy — most visibly `redirect`, where
        // a `new Request(url, { redirect: "manual" })` would start following
        // redirects instead of surfacing them.
        redirect: input.redirect,
        cache: input.cache,
        credentials: input.credentials,
        integrity: input.integrity,
        keepalive: input.keepalive,
        mode: input.mode,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        // An explicit `init` still wins, per the fetch contract.
        ...init,
      },
    ];
  }
  return [input instanceof URL ? input.href : input, init ?? {}];
}

/**
 * A fetch that routes through `HTTPS_PROXY` / `HTTP_PROXY`, honoring `NO_PROXY`,
 * or `undefined` when no proxy env var is set.
 *
 * Returning `undefined` rather than an identity wrapper is what keeps non-proxy
 * users paying nothing: callers assign the result straight into an optional
 * `fetch` slot, so undici is never imported and the built-in `fetch` is used as
 * before.
 *
 * The env is read once, when this is called, to decide *whether* to proxy at
 * all. The agent itself is created lazily on the first request, so merely
 * constructing a client costs nothing — and note that `EnvHttpProxyAgent`
 * captures the proxy URLs at *its* construction (measured), evaluating only
 * `NO_PROXY` per request. That is invisible in production, where the
 * environment does not change mid-process, but it means a test that mutates
 * `HTTP_PROXY` after any request has already been made is talking to an agent
 * that is not listening: the proxy suites isolate these variables for a whole
 * file so nothing can build the process-wide agent before they do.
 *
 * This belongs at the *bottom* of a client's fetch stack — the Node clients'
 * `environment.fetch` — because proxying now means substituting the fetch rather
 * than decorating one. Wrapping it around a supplied `fetchFn` (as the old
 * `withProxyDispatcher` did inside `createTransportNode`) would discard that
 * function's behavior; installing it underneath instead lets `InspectorClient`'s
 * own wrappers — request tracking, OAuth endpoint overrides — compose over it.
 * A side benefit: OAuth discovery and token requests go through
 * `environment.fetch` too, and were never proxied before.
 */
export function createProxyFetch(): typeof fetch | undefined {
  if (readProxyEnv() === undefined) return undefined;

  return async (input, init) => {
    loadedProxiedFetch ??= loadProxiedFetch();
    return (await loadedProxiedFetch)(input, init);
  };
}
