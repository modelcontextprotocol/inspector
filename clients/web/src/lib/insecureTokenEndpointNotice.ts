/**
 * Surfaces the SDK's refusal to post credentials to a non-TLS token endpoint as
 * the terminal configuration error it is (#2280).
 *
 * Lives in `lib/` rather than `utils/` because showing a notification is a side
 * effect; the copy it renders is pure and lives in `@inspector/core/auth`.
 *
 * Shaped as a claim-or-decline predicate rather than a plain `show(...)` so
 * every OAuth failure path that needs it can spend one line and keep its own
 * fall-through intact. Deliberately not enumerating the callers here: they have
 * gone from three to seven over this PR's review, and a list is a comment that
 * rots on the next one.
 *
 * ```ts
 * if (reportTerminalInsecureTokenEndpoint({ err, serverId: id, serverName, setReAuthBanner })) return;
 * ```
 *
 * `autoClose: false` matches the other non-recoverable OAuth notices (issuer
 * mismatch, unconfigured enterprise IdP): nothing the user does next will make
 * this reappear, so a toast that vanishes takes the only explanation with it.
 * It stops the notice **expiring**, not the user dismissing it — Mantine's close
 * control still works, which is correct for a message someone has finished
 * reading. Don't describe this as non-dismissible.
 */

import type { Dispatch, SetStateAction } from "react";
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
/**
 * Report the refusal **and** clear the re-auth banner for that server.
 *
 * This is the form every caller should use. The notice and the scoped banner
 * clear are one invariant, not two steps: a banner left behind carries a
 * Re-authenticate button as dead as the one this declines to offer, and the
 * user cannot tell which failure it belongs to. Keeping them together in one
 * place is what stops a future path doing half of it — an earlier revision made
 * that claim while hand-writing the pair at three call sites in a second hook,
 * which is exactly how it goes wrong.
 *
 * The clear is scoped to `serverId` and applied as a functional update: these
 * paths are asynchronous, so a late continuation for server A must not erase a
 * banner server B raised in the meantime.
 *
 * Generic over the banner shape rather than importing `ReAuthBannerState`:
 * `useOAuthRecovery` already imports this module, so naming its type here would
 * close a cycle. All this needs is a `serverId` to compare.
 *
 * @returns `true` when it was handled (the caller should stop), `false` when
 * `err` is some other failure and the caller's normal handling applies.
 */
export function reportTerminalInsecureTokenEndpoint<
  TBanner extends { serverId: string },
>({
  err,
  serverId,
  serverName,
  setReAuthBanner,
}: {
  err: unknown;
  serverId: string | undefined;
  serverName?: string;
  setReAuthBanner: Dispatch<SetStateAction<TBanner | null>>;
}): boolean {
  if (!showInsecureTokenEndpointNotice(err, serverName)) {
    return false;
  }
  setReAuthBanner((prev) => (prev && prev.serverId === serverId ? null : prev));
  return true;
}

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
