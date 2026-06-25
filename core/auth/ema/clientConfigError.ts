export type EmaClientNotConfiguredReason = "disabled" | "not_configured";

export function emaClientNotConfiguredMessage(
  reason: EmaClientNotConfiguredReason,
): string {
  if (reason === "disabled") {
    return (
      "This server uses enterprise-managed authorization, but Enterprise IdP is " +
      "turned off in Client Settings. Open Client Settings, enable " +
      '"Enterprise IdP configuration", then try connecting again.'
    );
  }
  return (
    "This server uses enterprise-managed authorization, but the Inspector " +
    "client IdP is not configured. Open Client Settings, enable Enterprise IdP, " +
    "and set issuer, client ID, and client secret."
  );
}

/** Thrown when connecting to an EMA server without active install-level IdP config. */
export class EmaClientNotConfiguredError extends Error {
  readonly reason: EmaClientNotConfiguredReason;

  constructor(reason: EmaClientNotConfiguredReason) {
    super(emaClientNotConfiguredMessage(reason));
    this.name = "EmaClientNotConfiguredError";
    this.reason = reason;
  }
}

export function isEmaClientNotConfiguredError(
  err: unknown,
): err is EmaClientNotConfiguredError {
  return err instanceof EmaClientNotConfiguredError;
}
