export interface SseError extends Error {
  code: number;
}

export function isSseError(error: unknown): error is SseError {
  if (!(error instanceof Error)) {
    return false;
  }

  return "code" in error && typeof error.code === "number";
}
