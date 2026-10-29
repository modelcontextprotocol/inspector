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
  compileLinearRegExp,
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

/** The `RegExpLike` Ajv calls `.test()` on for one pattern. */
class LinearPattern implements RegExpLike {
  private readonly source: string;
  private readonly flags: string;
  private readonly compiled: LinearRegExpCompilation;
  private readonly ledger: PatternLedger;

  constructor(
    source: string,
    flags: string,
    compiled: LinearRegExpCompilation,
    ledger: PatternLedger,
  ) {
    this.source = source;
    this.flags = flags;
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

  /** Ajv keys its per-schema pattern cache on this, so it must be unique. */
  toString(): string {
    return `/${this.source}/${this.flags}`;
  }
}

function createRegExpEngine(ledger: PatternLedger): RegExpEngine {
  const engine = (pattern: string, flags: string): RegExpLike =>
    new LinearPattern(
      pattern,
      flags,
      // Throws a SyntaxError for an invalid pattern, which Ajv surfaces as a
      // schema compilation failure — the same as the native engine.
      compileLinearRegExp(pattern, flags.includes("u")),
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

  private engineFor(dialect: Dialect): AjvEngine {
    let engine = this.engines.get(dialect);
    if (!engine) {
      const options: Options = {
        strict: false,
        validateFormats: true,
        validateSchema: false,
        allErrors: true,
        code: { regExp: createRegExpEngine(this.ledger) },
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
    const validate: ValidateFunction =
      (typeof id === "string" ? engine.getSchema(id) : undefined) ??
      engine.compile(schema);
    return (input: unknown) => {
      this.ledger.reset();
      const valid = validate(input);
      const unevaluated = [...this.ledger.unevaluated];
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
}
