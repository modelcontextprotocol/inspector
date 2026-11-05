import { createWriteStream, type WriteStream } from "node:fs";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { LoadSample, LoadSampleSink } from "./load-test.js";

/**
 * `--output <path>` with `--load` (#2838 item 5): every measured call as one
 * NDJSON line, for analysis the summary cannot do — a latency histogram of
 * your own, a scatter over time, a join against server logs by `seq`.
 *
 * Lines are queued on a write stream as calls complete, so writing never
 * holds up a call. A sample is never dropped, since the file is the
 * deliverable, so a disk slower than the run buffers in memory until it
 * catches up. A failure to open or write the file is reported once, after
 * the run, as the same `output_write_failed` error a plain `--output` uses.
 */
export type LoadSampleFile = {
  write: LoadSampleSink;
  /** Flush and close; rejects with `output_write_failed` on any error. */
  close: () => Promise<void>;
};

export function openLoadSampleFile(path: string): LoadSampleFile {
  const stream: WriteStream = createWriteStream(path, { encoding: "utf8" });
  // A stream's `error` event always carries an `Error`.
  let failure: Error | undefined;
  stream.on("error", (err: Error) => {
    failure ??= err;
  });
  return {
    write: (sample: LoadSample) => {
      if (failure === undefined) stream.write(`${JSON.stringify(sample)}\n`);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        const settle = (): void => {
          if (failure === undefined) {
            resolve();
            return;
          }
          reject(
            new CliExitCodeError(
              EXIT_CODES.USAGE,
              `Could not write --output file ${path}: ${failure.message}`,
              { code: "output_write_failed" },
            ),
          );
        };
        // `close` comes last whether the stream finished or failed (a
        // missing directory fails on open, possibly mid-flush), so by then
        // any error has been recorded. A stream already closed settles now.
        if (stream.closed) {
          settle();
          return;
        }
        stream.once("close", settle);
        stream.end();
      }),
  };
}
