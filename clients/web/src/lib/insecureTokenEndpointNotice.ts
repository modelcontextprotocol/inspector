/**
 * Surfaces the SDK's SEP-2207 refusal to post credentials to a non-TLS token
 * endpoint as the terminal configuration error it is (#2280).
 *
 * Lives in `lib/` rather than `utils/` because showing a notification is a side
 * effect; the copy it renders is pure and lives in `@inspector/core/auth`.
 *
 * Shaped as a claim-or-decline predicate rather than a plain `show(...)` so the
 * three OAuth failure paths that need it — the connect handshake, the post-
 * redirect callback, and the re-auth banner funnel — can each spend one line on
 * it and keep their existing fall-through intact:
 *
 * ```ts
 * if (showInsecureTokenEndpointNotice(err, server.name)) return;
 * ```
 *
 * `autoClose: false` matches the other non-recoverable OAuth notices (issuer
 * mismatch, unconfigured enterprise IdP): nothing the user does next will make
 * this reappear, so a toast that vanishes takes the only explanation with it.
 */

import { notifications } from "@mantine/notifications";
import { findInsecureTokenEndpoint } from "@inspector/core/auth/insecureTokenEndpoint.js";
import {
  insecureTokenEndpointMessage,
  insecureTokenEndpointTitle,
} from "../utils/oauthUx";

/**
 * Show the terminal notice when `err` is the SDK's `InsecureTokenEndpointError`.
 *
 * @returns `true` when it was handled (the caller should stop), `false` when
 * `err` is some other failure and the caller's normal handling applies.
 */
export function showInsecureTokenEndpointNotice(
  err: unknown,
  serverName?: string,
): boolean {
  // Searched rather than type-tested: era negotiation and the transport
  // wrappers bury the rejection under `cause` / `data.cause`, so the connect and
  // refresh paths hand us a wrapper rather than the error itself.
  const found = findInsecureTokenEndpoint(err);
  if (!found) {
    return false;
  }
  notifications.show({
    title: insecureTokenEndpointTitle(),
    message: insecureTokenEndpointMessage({
      tokenEndpoint: found.tokenEndpoint,
      serverName,
    }),
    color: "red",
    autoClose: false,
  });
  return true;
}
