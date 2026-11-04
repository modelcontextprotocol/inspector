/**
 * The JSON Schema validator provider the CLI hands the SDK `Client`, which
 * uses it to validate every `tools/call` result's `structuredContent` against
 * the tool's server-supplied `outputSchema`.
 *
 * It wraps the SDK's own default provider (`AjvJsonSchemaValidator`) and
 * changes one thing: the schema is passed through {@link stripSchemaPatterns}
 * first, so no server-supplied `pattern` / `patternProperties` regex is ever
 * run on the native backtracking `RegExp` engine, where a pattern such as
 * `^(a+)+$` and a near-match value would hang the CLI. Every other keyword is
 * still validated by the SDK's validator, unchanged.
 *
 * A schema that declares an identifier is not validated at all (see
 * stripSchemaPatterns); every result passes and the note says so.
 *
 * Skipped regexes are not silent: a failing result's message ends with the
 * "not evaluated" note, and a passing one reports it through `onNote` (the
 * CLI writes it to stderr, keeping stdout's JSON clean).
 */
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types.js";
import { schemaNote, stripSchemaPatterns } from "./stripSchemaPatterns.js";

export class RegexFreeJsonSchemaValidator implements jsonSchemaValidator {
  private readonly inner: jsonSchemaValidator;
  private readonly onNote: (note: string) => void;

  constructor(
    onNote: (note: string) => void,
    inner: jsonSchemaValidator = new AjvJsonSchemaValidator(),
  ) {
    this.onNote = onNote;
    this.inner = inner;
  }

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const result = stripSchemaPatterns(schema);
    const note = schemaNote(result);
    if (!result.validate) {
      // Not validated at all (the schema declares an identifier): every
      // result passes, and the note says the schema was not checked.
      return (input: unknown) => {
        this.onNote(note!);
        // Unchecked by design; `T` is what the caller asked the schema for.
        return { valid: true, data: input as T, errorMessage: undefined };
      };
    }
    // `stripSchemaPatterns` returns a structural copy of a JsonSchemaType
    // with keywords removed, which is still a JsonSchemaType.
    const validate = this.inner.getValidator<T>(
      result.schema as JsonSchemaType,
    );
    if (note === undefined) return validate;
    return (input: unknown) => {
      const checked = validate(input);
      if (checked.valid) {
        this.onNote(note);
        return checked;
      }
      return { ...checked, errorMessage: `${checked.errorMessage} (${note})` };
    };
  }
}
