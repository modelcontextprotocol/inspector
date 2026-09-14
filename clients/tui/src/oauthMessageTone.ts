/**
 * How the Auth tab should colour the OAuth note it is currently showing.
 *
 * The tone is **derived** from the message rather than stored beside it
 * (#2144). `App.tsx` sets an ordinary OAuth note in around thirty places, none
 * of which would think to reset a tone, so a second piece of state went stale
 * the moment one message raised it: a single revocation failure left every
 * later "Authorization updated" rendering as a warning, including after
 * switching servers.
 *
 * Comparing the shown message against the text that was raised as a warning
 * makes the tone a function of what is on screen, so it cannot outlive it —
 * the next `setOauthMessage` of anything else is informational by
 * construction, with nothing to remember to clear.
 *
 * `warning` is for a *partial* success: the OAuth state really was cleared, so
 * it is not an error status, but the grant may still be live at the
 * authorization server and the informational tone would understate that.
 */
export type OAuthMessageTone = "info" | "warning";

export function oauthMessageToneFor(
  message: string | null,
  warningText: string | null,
): OAuthMessageTone {
  // `null === null` must not read as a warning: with no message there is
  // nothing to colour.
  return message !== null && message === warningText ? "warning" : "info";
}
