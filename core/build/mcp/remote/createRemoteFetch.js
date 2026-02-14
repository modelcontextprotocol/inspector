/**
 * Creates a fetch implementation that POSTs requests to the remote /api/fetch endpoint.
 * Use in the browser to bypass CORS for OAuth and MCP HTTP requests.
 */
/**
 * Serialize request for the remote. Handles URLSearchParams body for OAuth token exchange.
 */
async function serializeRequest(input, init) {
    const url = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;
    const method = init?.method ??
        (typeof input === "object" && "method" in input
            ? input.method
            : "GET");
    const headers = {};
    if (input instanceof Request) {
        input.headers.forEach((v, k) => {
            headers[k] = v;
        });
    }
    if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((v, k) => {
            headers[k] = v;
        });
    }
    let body;
    if (init?.body !== undefined && init?.body !== null) {
        if (typeof init.body === "string") {
            body = init.body;
        }
        else if (init.body instanceof URLSearchParams) {
            body = init.body.toString();
        }
        else if (init.body instanceof FormData) {
            const params = new URLSearchParams();
            for (const [key, value] of init.body.entries()) {
                if (typeof value === "string") {
                    params.set(key, value);
                }
            }
            body = params.toString();
        }
        else {
            body = String(init.body);
        }
    }
    else if (input instanceof Request && input.body) {
        const cloned = input.clone();
        body = await cloned.text();
    }
    return { url, method, headers, body };
}
/**
 * Deserialize remote response into a Response object.
 */
function deserializeResponse(data) {
    return new Response(data.body ?? null, {
        status: data.status,
        statusText: data.statusText,
        headers: new Headers(data.headers ?? {}),
    });
}
/**
 * Returns a fetch function that forwards requests to the remote /api/fetch endpoint.
 * The remote server performs the actual HTTP request in Node (no CORS).
 */
export function createRemoteFetch(options) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    return async (input, init) => {
        const { url, method, headers, body } = await serializeRequest(input, init);
        const reqHeaders = {
            "Content-Type": "application/json",
            ...headers,
        };
        if (options.authToken) {
            reqHeaders["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
        }
        const res = await fetchFn(`${baseUrl}/api/fetch`, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify({ url, method, headers, body }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Remote fetch failed (${res.status}): ${text}`);
        }
        const data = (await res.json());
        return deserializeResponse(data);
    };
}
//# sourceMappingURL=createRemoteFetch.js.map