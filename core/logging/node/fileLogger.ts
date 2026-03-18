import pino from "pino";
import type { Logger } from "pino";

export interface CreateFileLoggerOptions {
  dest: string;
  append?: boolean;
  mkdir?: boolean;
  level?: string;
  name?: string;
}

/**
 * Creates a pino file logger whose destination is ready before use.
 * Waits for the destination's `ready` event so exit handlers can flush safely.
 * Use this instead of pino.destination({ dest }) + pino() when the process may exit early.
 */
export async function createFileLogger(
  options: CreateFileLoggerOptions,
): Promise<Logger> {
  const dest = pino.destination({
    dest: options.dest,
    append: options.append ?? true,
    mkdir: options.mkdir ?? true,
  });
  await new Promise<void>((resolve, reject) => {
    dest.once("ready", resolve);
    dest.once("error", reject);
  });
  return pino(
    {
      level: options.level ?? "info",
      ...(options.name !== undefined && { name: options.name }),
    },
    dest,
  );
}
