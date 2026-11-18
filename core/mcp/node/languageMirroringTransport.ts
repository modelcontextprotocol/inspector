/**
 * A Streamable HTTP client transport that mirrors each message's SEP-2792
 * language preference (`params._meta["io.modelcontextprotocol/acceptLanguage"]`)
 * into the `Accept-Language` header of the POST carrying it (#2987).
 *
 * Why at the transport, and why on every send: SEP-2792 makes `_meta` the
 * canonical carrier and requires a Streamable HTTP client to mirror it, with
 * exact equality, on *every* request — discovery and SDK-internal requests
 * included, not just the ones the Inspector issues by hand. The SDK does not
 * mirror it, and Node's `fetch` sends `Accept-Language: *` on any request
 * without one, so an unmirrored preference does not arrive as a tolerated
 * missing header but as a mismatch a strict server rejects. `send` is the one
 * place every outbound message passes, so overriding it covers all of them.
 *
 * This is the transport `createTransportNode` builds for the CLI, the TUI and
 * the web backend alike, so one implementation serves all three clients — the
 * backend no longer derives the header itself (#2979 did, before this).
 *
 * The header goes through the SDK's own per-send `headers` option, which it
 * applies after the configured `requestInit.headers`: the mirror therefore
 * replaces a configured `Accept-Language` instead of disagreeing with it.
 * Per-send headers a caller already passed (SEP-2243 `Mcp-Param-*`) are kept.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { acceptLanguageHeaderFor } from "../acceptLanguage.js";

type SendOptions = Parameters<StreamableHTTPClientTransport["send"]>[1];

export class LanguageMirroringStreamableHTTPClientTransport extends StreamableHTTPClientTransport {
  override send(
    message: JSONRPCMessage | JSONRPCMessage[],
    options?: SendOptions,
  ): Promise<void> {
    const languageHeader = acceptLanguageHeaderFor(message);
    if (!languageHeader) return super.send(message, options);
    return super.send(message, {
      ...options,
      headers: { ...options?.headers, ...languageHeader },
    });
  }
}
