import {
  isSerializableJson,
  type StrictJsonValue,
} from "../../json/jsonUtils.js";
import { CliExitCodeError, EXIT_CODES } from "../exit-codes.js";

/**
 * Varying arguments for `--load` (#2840), so the calls in a run are not all
 * identical. A server that caches results or dedupes identical requests looks
 * far faster under one fixed argument than under real traffic, and its
 * per-key code paths never run.
 *
 * Two mechanisms, usable together:
 *
 * - **Placeholders** in any string value of a call's arguments (`--tool-arg`,
 *   `--tool-args-json`, a scenario step's `args` or `uri`, an args-file row):
 *   `{{seq}}` — the call's number in start order, from 1; `{{worker}}` — the
 *   index of the worker making it, from 0; `{{uuid}}` — a fresh random UUID;
 *   `{{rand:<min>-<max>}}` — a random integer from `min` to `max` inclusive.
 *   Anything else in double braces is left as written, so an argument that is
 *   itself a Mustache or Handlebars template passes through untouched. A
 *   string that is exactly one numeric placeholder (`"{{seq}}"`,
 *   `"{{rand:1-9}}"`) becomes a number, so an integer-typed argument receives
 *   an integer; any other templated string stays a string.
 * - **An args file** (`--load-args-file`, NDJSON): one argument object per
 *   line, merged over the flag arguments, taken in turn or at random.
 *
 * Templates are compiled once, before the clock starts; a value with no
 * placeholder is reused as-is rather than copied per call.
 */

/** What a placeholder can depend on, for one call. */
export type LoadCallContext = {
  seq: number;
  worker: number;
  /**
   * The position `--load-args-file` rows cycle on, when it is not `seq`: a
   * `--load-workers` process's own call count (#2914). Not a placeholder.
   */
  row?: number;
};

/** Builds one call's value from its context. */
export type LoadTemplate<T> = (ctx: LoadCallContext) => T;

/** A float in [0, 1); injected by tests. */
export type LoadRandom = () => number;

/** Envelope code for a malformed placeholder or args file. */
export const LOAD_ARGS_INVALID = "load_args_invalid";

const PLACEHOLDER = /\{\{(seq|worker|uuid|rand:(-?\d+)-(-?\d+))\}\}/g;
const WHOLE_NUMERIC = /^\{\{(seq|worker|rand:(-?\d+)-(-?\d+))\}\}$/;

/**
 * Throw on a `{{rand:a-b}}` whose bounds are not safe integers with
 * `a <= b`, so a reversed range fails before the run rather than on every
 * call. Walks objects and arrays.
 */
export function checkLoadTemplate(value: unknown, where: string): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(PLACEHOLDER)) {
      if (m[2] === undefined) continue;
      const min = Number(m[2]);
      const max = Number(m[3]);
      // The span is checked too: `-9007199254740991-1` has safe bounds, but
      // its size rounds, which leaves the upper bound unreachable.
      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        min > max ||
        !Number.isSafeInteger(max - min + 1)
      ) {
        throw new Error(
          `${where}: ${m[0]} needs safe integer bounds with min <= max and a span (max - min + 1) no larger than ${Number.MAX_SAFE_INTEGER}.`,
        );
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkLoadTemplate(v, `${where}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      checkLoadTemplate(v, `${where}.${k}`);
    }
  }
}

/**
 * `{{uuid}}`: a random v4 UUID. `crypto.randomUUID` where it exists; the web
 * client runs this engine in the browser (#2911), where `randomUUID` needs a
 * secure context that a plain-HTTP, non-loopback host is not, so the
 * fallback builds the same v4 shape from `crypto.getRandomValues`, which is
 * not gated on one.
 */
export function loadUuid(cryptoImpl: Crypto = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  // RFC 9562 version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function substitute(
  token: string,
  min: string | undefined,
  max: string | undefined,
  ctx: LoadCallContext,
  random: LoadRandom,
): number | string {
  if (token === "seq") return ctx.seq;
  if (token === "worker") return ctx.worker;
  if (token === "uuid") return loadUuid();
  const lo = Number(min);
  return lo + Math.floor(random() * (Number(max) - lo + 1));
}

function compileString(
  value: string,
  random: LoadRandom,
): LoadTemplate<StrictJsonValue> | undefined {
  const whole = WHOLE_NUMERIC.exec(value);
  if (whole) {
    const [, token, min, max] = whole;
    return (ctx) => substitute(token!, min, max, ctx, random);
  }
  if (!new RegExp(PLACEHOLDER.source).test(value)) return undefined;
  return (ctx) =>
    value.replace(PLACEHOLDER, (_, token: string, min?: string, max?: string) =>
      String(substitute(token, min, max, ctx, random)),
    );
}

/**
 * Compile `value` into a template, or return `undefined` when nothing in it is
 * templated, so the caller can keep sending the value itself. Call
 * {@link checkLoadTemplate} first: an unchecked bad range compiles to a
 * template that returns `NaN`.
 */
export function compileLoadTemplate<T extends StrictJsonValue>(
  value: T,
  random: LoadRandom = Math.random,
): LoadTemplate<T> | undefined {
  return compileValue(value, random) as LoadTemplate<T> | undefined;
}

function compileValue(
  value: StrictJsonValue,
  random: LoadRandom,
): LoadTemplate<StrictJsonValue> | undefined {
  if (typeof value === "string") return compileString(value, random);
  if (Array.isArray(value)) {
    const parts = value.map((v) => compileValue(v, random));
    if (parts.every((p) => p === undefined)) return undefined;
    return (ctx) => value.map((v, i) => parts[i]?.(ctx) ?? v);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(
      ([k, v]) => [k, v, compileValue(v, random)] as const,
    );
    if (entries.every(([, , t]) => t === undefined)) return undefined;
    // `Object.fromEntries` defines own properties, so an own `__proto__` key
    // is copied as data rather than invoking the prototype setter.
    return (ctx) =>
      Object.fromEntries(entries.map(([k, v, t]) => [k, t ? t(ctx) : v]));
  }
  return undefined;
}

/** A templated value, or the value itself for every call. */
export function loadTemplateOrConstant<T extends StrictJsonValue>(
  value: T,
  random: LoadRandom = Math.random,
): LoadTemplate<T> {
  return compileLoadTemplate(value, random) ?? (() => value);
}

/** One row of an args file: an argument object. */
export type LoadArgsRow = Record<string, StrictJsonValue>;

/** How a run takes the rows of an args file. */
export type LoadArgRows = {
  rows: LoadArgsRow[];
  /** `sequential` (the default) takes row `(seq - 1) mod n`; `random` any row. */
  order: "sequential" | "random";
};

/**
 * Parse `--load-args-file` text: NDJSON, one argument object per non-blank
 * line. Each row must be a JSON object whose values survive serialization
 * (an overflowing `1e400` would reach the server as `null`), and its
 * placeholders must be well formed. Throws an `Error` naming the line.
 */
export function parseLoadArgsRows(text: string): LoadArgsRow[] {
  const rows: LoadArgsRow[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `line ${i + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `${where}: not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`${where}: each line must be a JSON object.`);
    }
    if (!isSerializableJson(parsed)) {
      throw new Error(
        `${where}: holds a number JSON cannot represent (overflowing to Infinity).`,
      );
    }
    checkLoadTemplate(parsed, where);
    rows.push(parsed as LoadArgsRow);
  });
  if (rows.length === 0) {
    throw new Error("the file holds no argument rows.");
  }
  return rows;
}

/**
 * {@link checkLoadTemplate} over the flag arguments, as a usage error. The
 * front ends call it before connecting.
 */
export function assertLoadArgsTemplate(value: unknown, where: string): void {
  try {
    checkLoadTemplate(value, where);
  } catch (err) {
    throw loadArgsError((err as Error).message);
  }
}

/**
 * A {@link LOAD_ARGS_INVALID} usage error (exit 1). Exported for the file
 * reader in `load-files.ts`.
 */
export function loadArgsError(message: string): CliExitCodeError {
  return new CliExitCodeError(EXIT_CODES.USAGE, message, {
    code: LOAD_ARGS_INVALID,
  });
}

/**
 * The per-call arguments for a tool load: `base` (the flag arguments) with
 * the row the call's `seq` selects merged over it, the row winning on a key
 * collision, every placeholder substituted.
 */
export function loadArgsTemplate(
  base: LoadArgsRow,
  argRows: LoadArgRows | undefined,
  random: LoadRandom = Math.random,
): LoadTemplate<LoadArgsRow> {
  if (!argRows) return loadTemplateOrConstant(base, random);
  const merged = argRows.rows.map((row) =>
    loadTemplateOrConstant({ ...base, ...row }, random),
  );
  const n = merged.length;
  return (ctx) => {
    const index =
      argRows.order === "random"
        ? Math.floor(random() * n)
        : ((ctx.row ?? ctx.seq) - 1) % n;
    return merged[index]!(ctx);
  };
}
