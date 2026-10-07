export function awaitableLog(logValue: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(logValue, () => {
      resolve();
    });
  });
}

/**
 * The stderr twin of {@link awaitableLog}.
 *
 * Both CLI exit paths call `process.exit()` as soon as the work returns
 * (`src/index.ts`, and `handleError` in `src/error-handler.ts`). When stderr
 * is a pipe or a file rather than a TTY, `write` is asynchronous, so anything
 * still buffered at that moment is discarded — which for a multi-block
 * `--strict` report means a truncated or entirely missing diagnostic on
 * exactly the redirected-output runs a CI caller uses.
 */
export function awaitableError(logValue: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stderr.write(logValue, () => {
      resolve();
    });
  });
}
