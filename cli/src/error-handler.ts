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

export function handleError(error: unknown): never {
  const errorMessage = formatError(error);
  if (process.env.DEBUG) {
    console.error("Full Error:", error);
  }
  console.error(errorMessage);

  process.exit(1);
}
