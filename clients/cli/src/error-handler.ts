/**
 * Thrown by the CLI to request a specific non-zero exit code without routing
 * through the generic error path. {@link handleError} reads `exitCode`; the
 * in-process test runner does the same so tests observe the real code.
 */
export class CliExitCodeError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CliExitCodeError";
  }
}

function formatError(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = "Unknown error";
  }

  return message;
}

function exitCodeOf(error: unknown): number {
  return error instanceof CliExitCodeError ? error.exitCode : 1;
}

export function handleError(error: unknown): never {
  const errorMessage = formatError(error);
  console.error(errorMessage);

  process.exit(exitCodeOf(error));
}
