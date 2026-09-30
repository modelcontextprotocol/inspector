/**
 * Process-wide line reader for interactive prompts (elicitation forms and
 * URL confirmations).
 *
 * Why not one `readline` interface per prompt exchange: readline discards
 * `line` events that fire while no `question()` is pending, and closing an
 * interface discards whatever input it already buffered. With a piped stdin
 * (`printf 'alice\n30\n' | mcpdo tools/call register`) every buffered line
 * after the first arrives while no question is listening — and the next
 * exchange's fresh interface starts from an empty (often already-EOF)
 * stream. So answers beyond the first were silently dropped.
 *
 * This reader owns a single persistent interface: every `line` event lands
 * in a queue, `question()` consumes from the queue before waiting for new
 * input, and "close" means *input exhausted* — EOF **and** an empty queue —
 * not merely EOF, so piped answers already received still get delivered.
 * Between questions the underlying stream is paused and unref'd, so the
 * reader never pins the event loop or holds a TTY hostage.
 */
import * as readline from "node:readline";

/**
 * The structural surface prompts consume: sequential questions plus an
 * exhausted-input notification. Implemented by {@link PromptReader};
 * narrow enough for tests to fake.
 */
export type PromptInput = {
  question(prompt: string): Promise<string>;
  once(event: "close", listener: () => void): unknown;
};

type Waiter = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
};

function exhaustedError(): Error {
  return new Error("stdin closed before an answer was given");
}

export class PromptReader implements PromptInput {
  private readonly rl: readline.Interface;
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly queued: string[] = [];
  private waiter: Waiter | undefined;
  private closeListeners: Array<() => void> = [];
  private eof = false;
  private exhaustedNotified = false;

  constructor(
    input: NodeJS.ReadStream = process.stdin,
    output: NodeJS.WriteStream = process.stderr,
  ) {
    this.input = input;
    this.output = output;
    this.rl = readline.createInterface({ input, output });
    this.rl.on("line", (line) => {
      const waiter = this.waiter;
      if (waiter) {
        this.waiter = undefined;
        this.park();
        waiter.resolve(line);
      } else {
        // No question pending (between fields, or input arrived up front):
        // keep the line for the next question instead of dropping it.
        this.queued.push(line);
      }
    });
    this.rl.once("close", () => {
      this.eof = true;
      const waiter = this.waiter;
      if (waiter) {
        this.waiter = undefined;
        this.notifyExhausted();
        waiter.reject(exhaustedError());
      }
    });
    this.park();
  }

  /**
   * Write `prompt` and resolve with the next input line — a queued one
   * first, else the next to arrive. Rejects once input is exhausted (EOF
   * with nothing queued).
   */
  question(prompt: string): Promise<string> {
    this.output.write(prompt);
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.eof) {
      this.notifyExhausted();
      return Promise.reject(exhaustedError());
    }
    this.engage();
    return new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  /**
   * `close` here means input is exhausted: EOF *and* no queued line left to
   * answer with. A raw stream close while answers are still queued must not
   * cancel a form those answers can complete.
   */
  once(event: "close", listener: () => void): this {
    if (event === "close") {
      if (this.exhaustedNotified) listener();
      else this.closeListeners.push(listener);
    }
    return this;
  }

  /** Tear down the underlying interface (tests / process cleanup). */
  dispose(): void {
    this.rl.close();
  }

  private notifyExhausted(): void {
    if (this.exhaustedNotified) return;
    this.exhaustedNotified = true;
    const listeners = this.closeListeners;
    this.closeListeners = [];
    for (const listener of listeners) listener();
  }

  /** Actively waiting for a line: let the stream flow and hold the loop. */
  private engage(): void {
    this.input.ref?.();
    this.rl.resume();
  }

  /** Idle between questions: stop reading and release the event loop. */
  private park(): void {
    this.rl.pause();
    this.input.unref?.();
  }
}

let shared: PromptReader | undefined;

/**
 * The stdin/stderr reader shared by every prompt in this process. Lazy: a
 * run that never prompts never touches stdin. Persistent: consecutive
 * elicitation exchanges in one command must share buffered piped input.
 */
export function getSharedPromptReader(): PromptReader {
  shared ??= new PromptReader();
  return shared;
}

/** Test hook: drop (and dispose) the shared reader between cases. */
export function resetSharedPromptReader(): void {
  shared?.dispose();
  shared = undefined;
}
