/**
 * Parses a form-mode elicitation `requestedSchema` into a flat list of
 * fields mcpdo can prompt for. Per the MRTR elicitation spec (2026-07-28),
 * form-mode schemas are restricted to a flat object whose properties are
 * primitive types only — string, number/integer, boolean, single-select
 * enum (`enum` or titled `oneOf`), or multi-select enum (`array` of one of
 * those) — so this never needs to handle nesting, arrays of objects, or
 * other general JSON Schema features.
 *
 * Returns `null` if the schema doesn't match that shape (defensive: a
 * well-behaved server never sends anything else, but this is untrusted
 * wire input from an arbitrary MCP server).
 */

export type Choice = { value: string; label: string };

type FieldExtra =
  | {
      kind: "string";
      minLength?: number;
      maxLength?: number;
      format?: string;
      default?: string;
    }
  | {
      kind: "number";
      integer: boolean;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | { kind: "boolean"; default?: boolean }
  | { kind: "enum"; choices: Choice[]; default?: string }
  | {
      kind: "multiselect";
      choices: Choice[];
      minItems?: number;
      maxItems?: number;
      default?: string[];
    };

export type FormField = {
  name: string;
  required: boolean;
  title: string;
  description?: string;
} & FieldExtra;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChoicesFromEnum(value: unknown): Choice[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((v) => typeof v !== "string")
  ) {
    return undefined;
  }
  return (value as string[]).map((v) => ({ value: v, label: v }));
}

function parseChoicesFromOneOf(value: unknown): Choice[] | undefined {
  // Empty choice sets are rejected (like empty `enum`): a required field
  // with zero options would render an unwinnable prompt.
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const choices: Choice[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.const !== "string") return undefined;
    choices.push({
      value: entry.const,
      label: typeof entry.title === "string" ? entry.title : entry.const,
    });
  }
  return choices;
}

/**
 * A structurally valid field can still be internally inconsistent —
 * unsatisfiable constraints (`minimum > maximum`, `minItems` above the
 * choice count) or a default that violates its own constraints. Those would
 * render unwinnable or instantly-invalid prompts, so treat them like any
 * other malformed schema and reject the field.
 */
function isConsistent(field: FieldExtra): boolean {
  switch (field.kind) {
    case "boolean":
      return true;
    case "number":
      if (
        field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum
      ) {
        return false;
      }
      if (field.default !== undefined) {
        if (field.integer && !Number.isInteger(field.default)) return false;
        if (field.minimum !== undefined && field.default < field.minimum)
          return false;
        if (field.maximum !== undefined && field.default > field.maximum)
          return false;
      }
      return true;
    case "string":
      if (
        field.minLength !== undefined &&
        field.maxLength !== undefined &&
        field.minLength > field.maxLength
      ) {
        return false;
      }
      if (field.default !== undefined) {
        if (
          field.minLength !== undefined &&
          field.default.length < field.minLength
        ) {
          return false;
        }
        if (
          field.maxLength !== undefined &&
          field.default.length > field.maxLength
        ) {
          return false;
        }
      }
      return true;
    case "enum":
      return (
        field.default === undefined ||
        field.choices.some((c) => c.value === field.default)
      );
    case "multiselect": {
      if (
        field.minItems !== undefined &&
        field.maxItems !== undefined &&
        field.minItems > field.maxItems
      ) {
        return false;
      }
      if (
        field.minItems !== undefined &&
        field.minItems > field.choices.length
      ) {
        return false;
      }
      const def = field.default;
      if (def !== undefined) {
        if (!def.every((v) => field.choices.some((c) => c.value === v))) {
          return false;
        }
        if (field.minItems !== undefined && def.length < field.minItems)
          return false;
        if (field.maxItems !== undefined && def.length > field.maxItems)
          return false;
      }
      return true;
    }
  }
}

function parseField(prop: unknown): FieldExtra | null {
  const parsed = parseFieldShape(prop);
  if (!parsed || !isConsistent(parsed)) return null;
  return parsed;
}

function parseFieldShape(prop: unknown): FieldExtra | null {
  if (!isRecord(prop)) return null;
  const type = prop.type;

  if (type === "boolean") {
    return {
      kind: "boolean",
      default: typeof prop.default === "boolean" ? prop.default : undefined,
    };
  }

  if (type === "number" || type === "integer") {
    return {
      kind: "number",
      integer: type === "integer",
      minimum: typeof prop.minimum === "number" ? prop.minimum : undefined,
      maximum: typeof prop.maximum === "number" ? prop.maximum : undefined,
      default: typeof prop.default === "number" ? prop.default : undefined,
    };
  }

  if (type === "string") {
    if (prop.enum !== undefined) {
      const enumChoices = parseChoicesFromEnum(prop.enum);
      // Present-but-invalid (non-string entries or an empty list) is a
      // malformed schema, not a freeform string field: an empty required
      // choice prompt would be unwinnable.
      if (!enumChoices) return null;
      return {
        kind: "enum",
        choices: enumChoices,
        default: typeof prop.default === "string" ? prop.default : undefined,
      };
    }
    if (prop.oneOf !== undefined) {
      const oneOfChoices = parseChoicesFromOneOf(prop.oneOf);
      if (!oneOfChoices) return null;
      return {
        kind: "enum",
        choices: oneOfChoices,
        default: typeof prop.default === "string" ? prop.default : undefined,
      };
    }
    return {
      kind: "string",
      minLength:
        typeof prop.minLength === "number" ? prop.minLength : undefined,
      maxLength:
        typeof prop.maxLength === "number" ? prop.maxLength : undefined,
      format: typeof prop.format === "string" ? prop.format : undefined,
      default: typeof prop.default === "string" ? prop.default : undefined,
    };
  }

  if (type === "array") {
    const items = prop.items;
    if (!isRecord(items)) return null;
    const choices =
      parseChoicesFromEnum(items.enum) ?? parseChoicesFromOneOf(items.anyOf);
    if (!choices) return null;
    const defaultValue =
      Array.isArray(prop.default) &&
      prop.default.every((v) => typeof v === "string")
        ? (prop.default as string[])
        : undefined;
    return {
      kind: "multiselect",
      choices,
      minItems: typeof prop.minItems === "number" ? prop.minItems : undefined,
      maxItems: typeof prop.maxItems === "number" ? prop.maxItems : undefined,
      default: defaultValue,
    };
  }

  return null;
}

/** Parse a `requestedSchema` into an ordered list of {@link FormField}s. */
export function parseFormSchema(
  schema: Record<string, unknown> | undefined,
): FormField[] | null {
  if (!isRecord(schema)) return null;
  const properties = schema.properties;
  if (!isRecord(properties)) return null;
  const required = Array.isArray(schema.required)
    ? (schema.required.filter((v) => typeof v === "string") as string[])
    : [];

  const fields: FormField[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const parsed = parseField(prop);
    if (!parsed) return null;
    const title =
      isRecord(prop) && typeof prop.title === "string" ? prop.title : name;
    const description =
      isRecord(prop) && typeof prop.description === "string"
        ? prop.description
        : undefined;
    fields.push({
      name,
      required: required.includes(name),
      title,
      description,
      ...parsed,
    } as FormField);
  }
  return fields;
}
