/**
 * The JSON Schema validator provider InspectorClient uses for schemas a server
 * supplies — a tool's `outputSchema` and an elicitation's `requestedSchema`.
 *
 * It is the SDK's Ajv configuration (same engines per declared dialect, same
 * options, same `ajv-formats` registration, same error text) with ONE change:
 * Ajv's `code.regExp` hook routes every `pattern` and `patternProperties`
 * regex through {@link compileLinearRegExp} instead of the native backtracking
 * `RegExp`. The schema is server-controlled, so a pattern like `^(a+)+$`
 * paired with a near-match `structuredContent` string would otherwise run in
 * exponential time on the thread that validates it — the Inspector's UI thread
 * in the web client, the event loop in the CLI and TUI.
 *
 * A pattern is evaluated in time proportional to input length × pattern size,
 * and the total of that work across one validation is capped by
 * {@link PATTERN_EVALUATION_BUDGET}. When a pattern cannot be evaluated — it
 * uses lookaround or a backreference, or the budget would be exceeded — the
 * value is NOT reported as valid: the validation result is `valid: false` with
 * a message naming the pattern that went unchecked and why. A skipped check
 * reading as a pass is the one outcome this provider must never produce.
 *
 * Why not the SDK's `AjvJsonSchemaValidator` with a custom engine: it accepts
 * one pre-configured Ajv instance but then uses it for EVERY dialect, dropping
 * the SDK's per-`$schema` dispatch. This class keeps that dispatch (mirroring
 * the SDK's `declaredDialect`) and builds each engine with the hook.
 */
import Ajv from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Options, ValidateFunction } from "ajv";
import { addFormats } from "@modelcontextprotocol/client/validators/ajv";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";
import {
  COMPILE_BUDGET_EXHAUSTED,
  compileLinearRegExp,
  isCompileBudgetExhausted,
  MAX_COMPILE_STEPS,
  MAX_PROGRAM_SIZE,
  type CompileBudget,
  type LinearRegExpCompilation,
} from "../json/linearRegExp.js";

/**
 * Upper bound on pattern-matching work in ONE validation, in
 * instruction-visits (input length × program size, summed over every pattern
 * test). Chosen so the worst case finishes well inside a frame budget of a few
 * hundred milliseconds while still covering ordinary payloads: a 1 MB
 * base64-shaped string against a `^[A-Za-z0-9+/]*={0,2}$` pattern costs about
 * 1.2e7. The bound is deterministic — it is checked before a pattern runs, not
 * measured while it runs.
 */
export const PATTERN_EVALUATION_BUDGET = 20_000_000;

/**
 * Upper bound on pattern COMPILATION in one schema, shared by every pattern
 * the schema compiles, as the evaluation budget is shared by every test. The
 * per-pattern limits restart for each pattern, so without this a schema of a
 * thousand distinct near-limit patterns would build millions of instructions
 * before a single value is validated. Ten patterns at the per-pattern limit.
 */
export const SCHEMA_COMPILE_BUDGET: Readonly<CompileBudget> = {
  steps: 10 * MAX_COMPILE_STEPS,
  size: 10 * MAX_PROGRAM_SIZE,
};

/** Longest pattern quoted verbatim in a "not evaluated" message. */
const MAX_QUOTED_PATTERN = 120;

const DRAFT_2020_12 = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "http://json-schema.org/draft/2020-12/schema",
]);
const DRAFT_2019_09 = new Set([
  "https://json-schema.org/draft/2019-09/schema",
  "http://json-schema.org/draft/2019-09/schema",
]);
const DRAFT_07_OR_06 = new Set([
  "https://json-schema.org/draft-07/schema",
  "http://json-schema.org/draft-07/schema",
  "https://json-schema.org/draft-06/schema",
  "http://json-schema.org/draft-06/schema",
]);

/** Ajv's custom-regex hook and what it returns (not re-exported from "ajv"). */
type RegExpEngine = NonNullable<NonNullable<Options["code"]>["regExp"]>;
type RegExpLike = ReturnType<RegExpEngine>;

type Dialect = "2020-12" | "2019-09" | "draft-7";

/** The SDK's `declaredDialect`, which it does not export. */
function declaredDialect(schema: JsonSchemaType): Dialect {
  const declared: unknown = (schema as { $schema?: unknown }).$schema;
  if (typeof declared !== "string") return "2020-12";
  const uri = declared.replace(/#$/, "");
  if (DRAFT_2020_12.has(uri)) return "2020-12";
  if (DRAFT_2019_09.has(uri)) return "2019-09";
  if (DRAFT_07_OR_06.has(uri)) return "draft-7";
  throw new Error(
    `JSON Schema declares an unsupported dialect ("$schema": "${declared.slice(0, 200)}"). Supported: JSON Schema 2020-12, 2019-09, draft-07, and draft-06.`,
  );
}

function quote(pattern: string): string {
  return pattern.length > MAX_QUOTED_PATTERN
    ? `${pattern.slice(0, MAX_QUOTED_PATTERN)}…`
    : pattern;
}

/**
 * The per-validation ledger every pattern test reports into. Validation is
 * synchronous, so one ledger per provider, reset at the start of each
 * validation, is exact.
 */
class PatternLedger {
  remaining = PATTERN_EVALUATION_BUDGET;
  readonly unevaluated = new Set<string>();

  reset(): void {
    this.remaining = PATTERN_EVALUATION_BUDGET;
    this.unevaluated.clear();
  }
}

/**
 * Distinguishes the cache keys of budget-declined patterns; see
 * {@link LinearPattern.key}.
 */
let budgetDeclinedKeys = 0;

/** The `RegExpLike` Ajv calls `.test()` on for one pattern. */
class LinearPattern implements RegExpLike {
  private readonly source: string;
  /**
   * What {@link toString} returns. Ajv's `usePattern` registers each regex in
   * the ENGINE-wide scope under `rx.toString()`, and that scope hands back the
   * first entry registered for a key — so whatever a key first names is what
   * every later schema on the engine tests against, whatever its own call to
   * the regex hook produced.
   *
   * That sharing is right for an outcome that depends only on the pattern: a
   * compiled program, or a decline for an unsupported construct or a pattern
   * too long or too complex, would come out the same for any schema. It is
   * wrong for a decline because ONE schema's compile budget ran out (#2934):
   * shared, it would leave the pattern declined for every later schema on the
   * engine, each of which has a budget of its own. Such a decline therefore
   * gets a key nothing else can register, so it stays with the schema whose
   * budget it reflects.
   */
  private readonly key: string;
  private readonly compiled: LinearRegExpCompilation;
  private readonly ledger: PatternLedger;

  constructor(
    source: string,
    flags: string,
    compiled: LinearRegExpCompilation,
    ledger: PatternLedger,
  ) {
    this.source = source;
    const shared = `/${source}/${flags}`;
    this.key =
      !compiled.ok && compiled.reason === COMPILE_BUDGET_EXHAUSTED
        ? `${shared}#${++budgetDeclinedKeys}`
        : shared;
    this.compiled = compiled;
    this.ledger = ledger;
  }

  test(input: string): boolean {
    if (!this.compiled.ok) {
      return this.skip(this.compiled.reason);
    }
    const { regExp } = this.compiled;
    const cost = regExp.cost(input);
    if (cost > this.ledger.remaining) {
      return this.skip(
        `checking a ${input.length}-character value would exceed the evaluation budget`,
      );
    }
    this.ledger.remaining -= cost;
    // The budget check above already guarantees this runs, so the
    // `undefined` ("over budget") answer cannot occur here.
    return regExp.search(input, cost) === true;
  }

  /**
   * Record that this pattern went unchecked. Answering `true` keeps Ajv from
   * also reporting a "must match pattern" error it has no grounds for; the
   * ledger entry is what makes the overall result invalid.
   */
  private skip(reason: string): boolean {
    this.ledger.unevaluated.add(
      `pattern "${quote(this.source)}" was not evaluated (${reason})`,
    );
    return true;
  }

  /** Ajv's scope key for this pattern; see {@link key}. */
  toString(): string {
    return this.key;
  }
}

function createRegExpEngine(
  ledger: PatternLedger,
  budget: () => CompileBudget,
): RegExpEngine {
  const engine = (pattern: string, flags: string): RegExpLike =>
    new LinearPattern(
      pattern,
      flags,
      // Throws a SyntaxError for an invalid pattern, which Ajv surfaces as a
      // schema compilation failure — the same as the native engine.
      compileLinearRegExp(pattern, flags.includes("u"), budget()),
      ledger,
    );
  // `code` is only read when Ajv generates standalone source, which this
  // provider never does; the property is required by `RegExpEngine`.
  return Object.assign(engine, { code: "linearRegExp" });
}

type AjvEngine = Ajv | Ajv2019 | Ajv2020;

/** A `jsonSchemaValidator` whose `pattern` checks run in bounded time. */
export class LinearPatternJsonSchemaValidator implements jsonSchemaValidator {
  private readonly ledger = new PatternLedger();
  private readonly engines = new Map<Dialect, AjvEngine>();
  /**
   * The budget every pattern compilation is charged to. {@link tracked} swaps
   * in a fresh one for each schema it compiles or looks up; outside it, the
   * provider-lifetime one below applies, so no path into Ajv — however it
   * reaches the regex hook — compiles a pattern without a budget.
   */
  private compileBudget: CompileBudget = { ...SCHEMA_COMPILE_BUDGET };
  /** Compiled schemas whose patterns overspent {@link SCHEMA_COMPILE_BUDGET}. */
  private readonly overBudget = new WeakSet<ValidateFunction>();

  private engineFor(dialect: Dialect): AjvEngine {
    let engine = this.engines.get(dialect);
    if (!engine) {
      const options: Options = {
        strict: false,
        validateFormats: true,
        validateSchema: false,
        allErrors: true,
        code: {
          regExp: createRegExpEngine(this.ledger, () => this.compileBudget),
        },
      };
      engine =
        dialect === "2020-12"
          ? new Ajv2020(options)
          : dialect === "2019-09"
            ? new Ajv2019(options)
            : new Ajv(options);
      addFormats(engine);
      this.engines.set(dialect, engine);
    }
    return engine;
  }

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const engine = this.engineFor(declaredDialect(schema));
    const id: unknown = (schema as { $id?: unknown }).$id;
    // `getSchema` can compile too: Ajv compiles a schema registered by `$id`
    // — including a `$defs` entry of an earlier schema — on first lookup.
    const validate: ValidateFunction = this.tracked(
      () =>
        (typeof id === "string" ? engine.getSchema(id) : undefined) ??
        engine.compile(schema),
    );
    const overBudget = this.overBudget.has(validate);
    return (input: unknown) => {
      this.ledger.reset();
      const valid = validate(input);
      const unevaluated = [...this.ledger.unevaluated];
      if (overBudget) {
        // Some of the schema's patterns were never compiled, so a value that
        // reaches none of them is still not one the schema was checked for.
        unevaluated.unshift(
          "the schema's patterns exceed the compilation budget",
        );
      }
      if (valid && unevaluated.length === 0) {
        // Ajv's `validate` is a type guard only in its generic form; the
        // provider contract hands the caller its own `T`.
        return { valid: true, data: input as T, errorMessage: undefined };
      }
      const messages = valid ? [] : [engine.errorsText(validate.errors)];
      if (unevaluated.length > 0) {
        messages.push(
          `${unevaluated.join("; ")}, so the value could not be verified against the schema`,
        );
      }
      return {
        valid: false,
        data: undefined,
        errorMessage: messages.join("; "),
      };
    };
  }

  /**
   * Run an Ajv entry point with every pattern it compiles charged to one fresh
   * budget, and remember the function it returns if that budget ran out.
   */
  private tracked(run: () => ValidateFunction): ValidateFunction {
    const outer = this.compileBudget;
    const budget = { ...SCHEMA_COMPILE_BUDGET };
    this.compileBudget = budget;
    try {
      const validate = run();
      if (isCompileBudgetExhausted(budget)) this.overBudget.add(validate);
      return validate;
    } finally {
      this.compileBudget = outer;
    }
  }
}
