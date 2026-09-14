// Error-shaping helpers shared by the toast bodies and the detail modals.
// Deliberately duck-typed rather than coupled to the SDK's error classes: the
// values reaching here come off a `catch`, so their only guaranteed type is
// `unknown`.

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The numeric JSON-RPC code of a thrown protocol error (e.g. a `ProtocolError`
// carrying `-32602`), or undefined for a plain Error. Duck-typed like
// `formatErrorDetails` so we don't couple to the SDK's error class here — the
// only consumer is the Tools error panel's unknown-tool (`-32602`) hint (#1632).
export function errorCodeOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

// Pretty-print a thrown error for the URL-elicitation details modal: a ProtocolError
// carries a `code`/`data` worth showing alongside the message, so include them
// when present; otherwise fall back to the plain message.
export function formatErrorDetails(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; data?: unknown };
    if (e.code !== undefined || e.data !== undefined) {
      return JSON.stringify(
        { code: e.code, message: e.message, data: e.data },
        null,
        2,
      );
    }
  }
  return errorMessage(err);
}
