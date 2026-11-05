import {
  isSerializableJson,
  type StrictJsonValue,
} from "../../json/jsonUtils.js";
import { CliExitCodeError, EXIT_CODES } from "../exit-codes.js";
import { checkLoadTemplate } from "./load-template.js";

/**
 * `--load-scenario <file>` (#2839): a weighted mix of `tools/call`,
 * `resources/read` and `prompts/get` steps for one `--load` run, in place of
 * the single tool `--tool-name` names.
 *
 * This module only reads, validates and schedules a scenario; the engine in
 * `load-test.ts` runs it. Validation is strict — an unknown key is an error,
 * not ignored — because a typo such as `"argument"` for `"args"` would
 * otherwise send every call without its arguments and report a healthy run of
 * the wrong request.
 *
 * The file is read by the front end (the one-shot CLI, or mcpdo's client
 * process), never by the mcpdo daemon: a relative path means the caller's
 * working directory, and the daemon's is not that. The parsed scenario then
 * travels to the engine inside `LoadOptions`.
 */

/** The methods a scenario step may call. */
export const LOAD_SCENARIO_METHODS = [
  "tools/call",
  "resources/read",
  "prompts/get",
] as const;

export type LoadScenarioMethod = (typeof LOAD_SCENARIO_METHODS)[number];

/** A JSON object, as a step's `args` and `meta` are. */
export type LoadScenarioObject = Record<string, StrictJsonValue>;

/**
 * One validated step. `name` is always set — the label the summary reports
 * it under — and unique within the scenario; `weight` defaults to 1.
 */
export type LoadScenarioStep = {
  name: string;
  weight: number;
  /** `_meta` for this step's requests, over any `--metadata`. */
  meta?: LoadScenarioObject;
} & (
  | { method: "tools/call"; tool: string; args?: LoadScenarioObject }
  | { method: "resources/read"; uri: string }
  | { method: "prompts/get"; prompt: string; args?: LoadScenarioObject }
);

export type LoadScenario = { steps: LoadScenarioStep[] };

/** Envelope code for a scenario file that cannot be read or is malformed. */
export const LOAD_SCENARIO_INVALID = "load_scenario_invalid";

/** The keys each method's step may carry; anything else is a typo. */
const STEP_KEYS: Record<LoadScenarioMethod, readonly string[]> = {
  "tools/call": ["method", "name", "weight", "meta", "tool", "args"],
  "resources/read": ["method", "name", "weight", "meta", "uri"],
  "prompts/get": ["method", "name", "weight", "meta", "prompt", "args"],
};

/** The key naming what a step calls, per method. */
const TARGET_KEY = {
  "tools/call": "tool",
  "resources/read": "uri",
  "prompts/get": "prompt",
} as const satisfies Record<LoadScenarioMethod, string>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMethod(value: unknown): value is LoadScenarioMethod {
  return (LOAD_SCENARIO_METHODS as readonly unknown[]).includes(value);
}

/** What a step calls: its tool name, resource URI or prompt name. */
export function loadStepTarget(step: LoadScenarioStep): string {
  switch (step.method) {
    case "tools/call":
      return step.tool;
    case "resources/read":
      return step.uri;
    case "prompts/get":
      return step.prompt;
  }
}

function invalid(message: string): Error {
  return new Error(message);
}

function optionalObject(
  step: Record<string, unknown>,
  key: string,
  where: string,
): LoadScenarioObject | undefined {
  const value = step[key];
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw invalid(`${where}: "${key}" must be a JSON object.`);
  }
  // `JSON.parse` turns an overflowing number (`1e400`) into `Infinity`, which
  // the next `JSON.stringify` — mcpdo's hand-off to its daemon — would send
  // as `null`, quietly changing the request under test.
  if (!isSerializableJson(value)) {
    throw invalid(
      `${where}: "${key}" holds a number JSON cannot represent (overflowing to Infinity).`,
    );
  }
  return value as LoadScenarioObject;
}

function validateStep(raw: unknown, index: number): LoadScenarioStep {
  const where = `step ${index + 1}`;
  if (!isObject(raw)) throw invalid(`${where} must be a JSON object.`);
  const { method } = raw;
  if (!isMethod(method)) {
    throw invalid(
      `${where}: "method" must be one of ${LOAD_SCENARIO_METHODS.join(", ")}.`,
    );
  }
  const allowed = STEP_KEYS[method];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw invalid(
        `${where}: unknown key "${key}" for ${method} (allowed: ${allowed.join(", ")}).`,
      );
    }
  }
  const targetKey = TARGET_KEY[method];
  const target = raw[targetKey];
  if (typeof target !== "string" || target.trim() === "") {
    throw invalid(`${where}: ${method} needs a non-empty "${targetKey}".`);
  }
  // Placeholders (#2840) may appear in `args` and in a `uri`; a reversed
  // `{{rand:9-1}}` fails here rather than on every call.
  checkLoadTemplate(raw.args, `${where} args`);
  if (method === "resources/read") checkLoadTemplate(target, `${where} uri`);
  // Defaulted only when absent: an explicit `null` is a malformed weight.
  const weight = raw.weight === undefined ? 1 : raw.weight;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
    throw invalid(`${where}: "weight" must be a positive number.`);
  }
  const name = raw.name;
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    throw invalid(`${where}: "name" must be a non-empty string.`);
  }
  const meta = optionalObject(raw, "meta", where);
  const common = {
    // A placeholder until every step is known; see `nameSteps`.
    name: typeof name === "string" ? name : "",
    weight,
    ...(meta !== undefined && { meta }),
  };
  switch (method) {
    case "tools/call": {
      const args = optionalObject(raw, "args", where);
      return {
        ...common,
        method,
        tool: target,
        ...(args !== undefined && { args }),
      };
    }
    case "resources/read":
      return { ...common, method, uri: target };
    case "prompts/get": {
      const args = optionalObject(raw, "args", where);
      return {
        ...common,
        method,
        prompt: target,
        ...(args !== undefined && { args }),
      };
    }
  }
}

/**
 * Give every unnamed step its default label, `<method> <target>`, and make
 * the labels unique. Two unnamed steps on the same target (one tool, two
 * argument sets) are told apart by their position, `#<step number>`; two
 * explicit names that collide are an error, since the author meant both.
 */
function nameSteps(steps: LoadScenarioStep[], explicit: boolean[]): void {
  const taken = new Set<string>();
  steps.forEach((step, i) => {
    if (!explicit[i]) return;
    if (taken.has(step.name)) {
      throw invalid(`step ${i + 1}: duplicate name "${step.name}".`);
    }
    taken.add(step.name);
  });
  const defaults = steps.map((s) => `${s.method} ${loadStepTarget(s)}`);
  steps.forEach((step, i) => {
    if (explicit[i]) return;
    const label = defaults[i]!;
    const shared = defaults.some(
      (d, j) => j !== i && !explicit[j] && d === label,
    );
    let name = shared ? `${label} #${i + 1}` : label;
    if (taken.has(name)) name = `${label} #${i + 1}`;
    // Only an explicit name spelled exactly like a numbered default lands here.
    if (taken.has(name)) {
      throw invalid(`step ${i + 1}: duplicate name "${name}".`);
    }
    taken.add(name);
    step.name = name;
  });
}

/**
 * Validate a parsed scenario: either an array of steps, or an object whose
 * `steps` is one. Throws an `Error` naming the first problem.
 */
export function validateLoadScenario(value: unknown): LoadScenario {
  let rawSteps: unknown;
  if (Array.isArray(value)) {
    rawSteps = value;
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (key !== "steps") {
        throw invalid(`unknown key "${key}" (allowed: steps).`);
      }
    }
    rawSteps = value.steps;
  }
  if (!Array.isArray(rawSteps)) {
    throw invalid(
      'a scenario must be an array of steps, or an object with a "steps" array.',
    );
  }
  if (rawSteps.length === 0) {
    throw invalid("a scenario needs at least one step.");
  }
  const steps = rawSteps.map(validateStep);
  const explicit = rawSteps.map(
    (raw) => isObject(raw) && typeof raw.name === "string",
  );
  nameSteps(steps, explicit);
  return { steps };
}

/** Parse and validate scenario JSON text; `source` names it in errors. */
export function parseLoadScenario(text: string, source: string): LoadScenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw loadScenarioError(
      source,
      `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return validateLoadScenario(parsed);
  } catch (err) {
    throw loadScenarioError(source, (err as Error).message);
  }
}

/**
 * A {@link LOAD_SCENARIO_INVALID} usage error (exit 1) naming `source`.
 * Exported for the file reader in `load-files.ts`.
 */
export function loadScenarioError(
  source: string,
  problem: string,
): CliExitCodeError {
  return new CliExitCodeError(
    EXIT_CODES.USAGE,
    `--load-scenario ${source}: ${problem}`,
    { code: LOAD_SCENARIO_INVALID },
  );
}

/**
 * The step-picking order for a scenario: smooth weighted round-robin (the
 * nginx upstream algorithm). Each pick adds every step's weight to its running
 * score, takes the highest, and charges it the total. That interleaves the
 * steps — weights 2:1 run A, B, A, not A, A, B — and keeps the mix exact over
 * each full cycle, where a random pick drifts on a short run and makes two
 * runs incomparable. Fractional weights work the same way.
 *
 * Returns the index of the next step on each call.
 */
export function createWeightedPicker(weights: readonly number[]): () => number {
  // A running score stays within about twice the weights' sum, so weights
  // that large (two valid 1e308s, or 1.19e308 and 5.1e307, whose sum is still
  // finite) would overflow a score to Infinity and skew every later pick.
  // Those are scaled down by the largest; only the ratios matter. Others are
  // left alone, so integer weights stay integers and the mix stays exact with
  // no floating-point drift. The 4x leaves headroom over the 2x bound.
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const largest = Number.isFinite(sum * 4) ? 1 : Math.max(...weights);
  const scaled = weights.map((w) => w / largest);
  const total = scaled.reduce((sum, w) => sum + w, 0);
  const current = scaled.map(() => 0);
  return () => {
    let best = 0;
    for (let i = 0; i < weights.length; i++) {
      current[i]! += scaled[i]!;
      if (current[i]! > current[best]!) best = i;
    }
    current[best]! -= total;
    return best;
  };
}
