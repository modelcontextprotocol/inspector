/**
 * Converts JSON Schema to ink-form format
 */

import type { FormStructure, FormSection, FormField } from "ink-form";
import {
  admitsNull,
  isStringEnum,
  normalizeNullableUnion,
} from "@inspector/core/json/nullableUnion.js";
import { resolveRootUnion } from "@inspector/core/json/rootUnion.js";

/** Minimal JSON Schema property shape used when building tool parameter forms */
interface JsonSchemaProperty {
  /**
   * An array here is the `["string", "null"]` nullable encoding, which
   * {@link normalizeNullableUnion} collapses to a single name before the
   * dispatch below reads it.
   */
  type?: string | string[];
  title?: string;
  enum?: unknown[];
  /** Non-standard legacy support: titles for enum values */
  enumNames?: string[];
  items?: { enum?: unknown[]; enumNames?: string[] };
  minimum?: number;
  maximum?: number;
  default?: unknown;
  /** A one-value enumeration; seeded like a `default` — see below. */
  const?: unknown;
  /** Present on a nullable union; see {@link normalizeNullableUnion}. */
  anyOf?: readonly unknown[];
}

/**
 * Build ink-form select options from enum values, using their non-standard
 * `enumNames` titles as labels when present and length-matched. Falls back to
 * the stringified value as the label otherwise, since a wrong-length zip would
 * mislabel options — worse than showing raw values.
 */
function toSelectOptions(
  values: unknown[],
  names: string[] | undefined,
): { label: string; value: string }[] {
  const useNames = names !== undefined && names.length === values.length;
  return values.map((val, index) => ({
    label: useNames ? names[index] : String(val),
    value: String(val),
  }));
}

/**
 * Minimal JSON Schema object shape (properties + required). Property values are
 * `unknown` so the SDK's broadly-typed `Tool["inputSchema"]` (whose `properties`
 * values are the recursive JSON type) is assignable here; each value is narrowed
 * to {@link JsonSchemaProperty} at the point of use below.
 */
interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
  /**
   * Root composition, read by {@link resolveRootUnion} before `properties` is
   * enumerated (#2123). Members are `unknown` for the same reason property
   * values are: the SDK's `Tool["inputSchema"]` types them as the recursive
   * JSON type, and each is narrowed where it is used.
   */
  type?: string | string[];
  allOf?: readonly unknown[];
  anyOf?: readonly unknown[];
  oneOf?: readonly unknown[];
  discriminator?: { propertyName?: string };
}

/**
 * The select that names which alternative of a root union the call is making.
 *
 * ink-form keeps **one** value object for the whole form, keyed by field name
 * alone — sections are visual grouping, not scope. So two branches of a
 * discriminated union both declaring `kind` are the *same* field: the later
 * section's initial value wins, and filling the first branch's section would
 * submit the second branch's discriminator. Prefixing each branch's fields and
 * choosing between them explicitly is what makes the alternatives independent.
 */
/**
 * The generated field names a root-union form uses, chosen so they cannot
 * collide with a property the schema itself declares.
 *
 * JSON object property names have no reserved namespace: a server may declare
 * an argument called `__variant`, or one starting with `__b`. A fixed prefix
 * would then either be shadowed by that argument or would silently swallow it
 * on the way out, so both names are extended with `_` until nothing declared
 * can be confused with them. Derived from the schema alone, so
 * {@link schemaToForm} and {@link decodeFormValues} compute the same names
 * without passing anything between them.
 */
function generatedNames(
  base: { properties?: Record<string, unknown> },
  branches: { declaredFields: string[] }[],
): { variant: string; prefix: string } {
  const declared = [
    ...Object.keys(base.properties ?? {}),
    ...branches.flatMap((branch) => branch.declaredFields),
  ];
  let variant = "__variant";
  while (declared.includes(variant)) variant += "_";
  let prefix = "__b";
  while (declared.some((name) => name.startsWith(prefix))) prefix += "_";
  return { variant, prefix };
}

/** The form-local name a branch's field is rendered under. */
function branchFieldName(
  prefix: string,
  branchIndex: number,
  name: string,
): string {
  return `${prefix}${branchIndex}__${name}`;
}

/**
 * Base-declared names that at least one branch also declares. They move out of
 * the base section and into every branch's, so the branch showing is the one
 * whose declaration renders — and so a branch that does not specialize the name
 * still offers it rather than losing a root argument it must supply.
 */
function sharedFieldNames(
  base: { properties?: Record<string, unknown> },
  branches: { declaredFields: string[] }[],
): string[] {
  const declared = new Set(branches.flatMap((branch) => branch.declaredFields));
  return Object.keys(base.properties ?? {}).filter((name) =>
    declared.has(name),
  );
}

/** The property names one branch's section renders, under prefixed names. */
function branchFields(
  base: { properties?: Record<string, unknown> },
  branches: { declaredFields: string[] }[],
  index: number,
): string[] {
  const own = branches[index]!.declaredFields;
  return [...new Set([...own, ...sharedFieldNames(base, branches)])];
}

/**
 * A property declaration carrying the name it was declared under as its
 * fallback `title`, so a renamed field still displays the schema's own name.
 */
function labelled(property: unknown, name: string): unknown {
  if (typeof property !== "object" || property === null) {
    // JSON Schema's `true` constrains nothing, so a title-only object says the
    // same thing and carries the label.
    return { title: name };
  }
  return { title: name, ...property };
}

/** A schema's `required`, as the list of strings it should be. */
function requiredOf(schema: { required?: unknown }): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
}

/** The `const` a property schema pins its value to, if any. */
function constOf(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return undefined;
  return (schema as { const?: unknown }).const;
}

/**
 * Converts a JSON Schema to ink-form structure
 */
export function schemaToForm(
  schema: JsonSchemaObject | null | undefined,
  toolName: string,
): FormStructure {
  const title = `Test Tool: ${toolName}`;
  if (!schema) {
    return { title, sections: [{ title: "Parameters", fields: [] }] };
  }

  // Flatten root composition before reading `properties` (#2123). Without it a
  // tool whose arguments are declared as a root `oneOf`/`anyOf` — legal since
  // the 2026-07-28 revision — rendered a form with no fields at all, so it
  // could only be called with empty arguments.
  const { base, branches } = resolveRootUnion(schema);

  if (branches.length === 0) {
    return {
      title,
      sections: [{ title: "Parameters", fields: buildFields(base) }],
    };
  }

  const { variant, prefix } = generatedNames(base, branches);
  const shared = sharedFieldNames(base, branches);

  // The base section renders what the base *alone* declares. A property some
  // branch also declares moves into every branch's section, so the branch's
  // specialization is what renders there — root `count: {}` under branch
  // `count: { type: "number" }` is a number field, not a string — while a
  // branch that does not specialize it still offers it, under its own inherited
  // declaration. Rendering it once in the base section instead would strand it:
  // the chosen branch's decoded fields are what reach the call.
  const baseProperties = Object.fromEntries(
    Object.entries(base.properties ?? {}).filter(
      ([name]) => !shared.includes(name),
    ),
  );

  // ink-form is static, so there is no picker that can swap the fields out.
  // Every branch is rendered instead, and this select says which one the call
  // means — read back by `decodeFormValues`, which drops the rest.
  const parameters: FormField[] = [
    {
      type: "select",
      name: variant,
      label: "Variant",
      required: true,
      initialValue: "0",
      options: branches.map((branch, index) => ({
        label: branch.label,
        value: String(index),
      })),
    } as FormField,
    ...buildFields({ properties: baseProperties, required: base.required }),
  ];

  const sections: FormSection[] = [{ title: "Parameters", fields: parameters }];

  // One section per alternative, its fields **optional** whatever the branch
  // says: only one alternative applies to a call, so requiring them would build
  // a form that can never be submitted.
  branches.forEach((branch, index) => {
    const byRealName = Object.fromEntries(
      branchFields(base, branches, index).map((name) => [name, true]),
    );
    const properties = Object.fromEntries(
      branchFields(base, branches, index).map((name) => [
        branchFieldName(prefix, index, name),
        // The prefix is an internal field NAME, never a label: `buildFields`
        // falls back to its map key when a declaration carries no `title`, so
        // without this the form would show `__b0__address` where the schema
        // says `address`.
        labelled(branch.schema.properties?.[name], name),
      ]),
    );
    sections.push({
      title: branch.label,
      fields: buildFields(
        {
          properties,
          // Under their prefixed names, so the constant seeding below can tell
          // which of this branch's fields the schema actually requires.
          required: requiredOf(branch.schema)
            .filter((name) => Object.hasOwn(byRealName, name))
            .map((name) => branchFieldName(prefix, index, name)),
        },
        { optional: true },
      ),
    });
  });

  return { title, sections };
}

/**
 * Turn what the form submitted back into the arguments the server expects:
 * the base fields, plus the fields of the branch the variant select names,
 * under their real property names.
 *
 * Every other branch's fields are dropped rather than sent — they describe a
 * shape this call is not making, and the user filled at most one section. The
 * generated names are filtered by exact match rather than by prefix, so an
 * argument the server really named `__b0__x` survives.
 *
 * A `const` is re-applied from the schema rather than taken from the form.
 * ink-form has no immutable field, so a discriminator is rendered as a
 * one-option select and its value is restored here regardless — which also
 * keeps a non-string constant's type, since a select hands back a string.
 *
 * Call this on the way out of the form; for a schema with no root union it
 * returns the values unchanged, so it is safe to apply unconditionally.
 */
export function decodeFormValues<T>(
  schema: JsonSchemaObject | null | undefined,
  values: Record<string, T>,
): Record<string, T> {
  const { base, branches } = resolveRootUnion(schema ?? {});
  if (branches.length === 0) {
    return applyConstants(base.properties ?? {}, values, requiredOf(base));
  }

  const { variant, prefix } = generatedNames(base, branches);
  const branchIndex = selectedBranchIndex(base, branches, values);
  const branch = branches[branchIndex]!;

  const generated = new Set<string>([variant]);
  branches.forEach((_each, index) => {
    for (const name of branchFields(base, branches, index)) {
      generated.add(branchFieldName(prefix, index, name));
    }
  });

  // Built through `fromEntries` rather than by assignment: `__proto__` is a
  // legal argument name, and assigning it would invoke the legacy prototype
  // setter — the field would be prefixed safely in the form and then vanish on
  // the way to the call.
  const decoded: Record<string, T> = Object.fromEntries([
    ...Object.entries(values).filter(([name]) => !generated.has(name)),
    ...branchFields(base, branches, branchIndex)
      .map(
        (name) =>
          [name, values[branchFieldName(prefix, branchIndex, name)]] as const,
      )
      .filter(([, value]) => value !== undefined),
  ]);
  /* v8 ignore next -- an offerable branch always carries properties */
  return applyConstants(
    branch.schema.properties ?? {},
    decoded,
    requiredOf(branch.schema),
  );
}

/**
 * Which branch the variant select names, clamped to one that exists — a form
 * value is whatever the user's terminal produced, and the fallback is the first
 * branch, which is what the select opens on.
 */
function selectedBranchIndex(
  base: { properties?: Record<string, unknown> },
  branches: { declaredFields: string[] }[],
  values: Record<string, unknown>,
): number {
  const { variant } = generatedNames(base, branches);
  const selected = Number(values[variant]);
  return Number.isInteger(selected) &&
    selected >= 0 &&
    selected < branches.length
    ? selected
    : 0;
}

/**
 * Overwrite every `const`-pinned field with the value its schema fixes —
 * where the field is PRESENT, or where the schema also requires it.
 *
 * `const` constrains a present value; it neither requires the property nor
 * acts as a default. Restoring an optional one the user left blank would send
 * it on every call.
 */
function applyConstants<T>(
  properties: Record<string, unknown>,
  values: Record<string, T>,
  required: string[],
): Record<string, T> {
  const pinned = Object.entries(properties).filter(
    ([name, schema]) =>
      constOf(schema) !== undefined &&
      (required.includes(name) ||
        (Object.hasOwn(values, name) && values[name] !== undefined)),
  );
  if (pinned.length === 0) return values;
  return Object.fromEntries([
    ...Object.entries(values),
    ...pinned.map(([name, schema]) => [name, constOf(schema) as T]),
  ]);
}

/**
 * Build the ink-form fields for one already-flattened object schema.
 *
 * `optional` renders every field non-required whatever the schema says, for a
 * branch section: only one alternative applies to a call, so demanding all of
 * them would build a form that can never be submitted. The schema's own
 * `required` is still read — it decides which constants are pre-filled, and
 * `missingRequiredFields` enforces the real requirement at submit.
 */
function buildFields(
  schema: JsonSchemaObject,
  { optional = false }: { optional?: boolean } = {},
): FormField[] {
  const fields: FormField[] = [];
  const properties = schema.properties || {};
  // `Array.isArray`, not `|| []`: a nonconforming server can send
  // `required: "x"`, and `.includes` on a string silently matches substrings.
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const [key, prop] of Object.entries(properties)) {
    // `properties` values are `unknown` (the SDK schema admits anything), so
    // guard before treating a value as a schema object — a malformed server
    // schema with e.g. `properties: { foo: null }` must not throw on `.title`.
    // Flatten a nullable union (`anyOf: [X, {type:"null"}]`, `type: [X,"null"]`)
    // before dispatching. Every branch below reads a single `type` string, and
    // for an enum the `enum` keyword sits on the union's surviving branch — so
    // without this an argument declared with Zod's `.nullish()` loses its
    // select and degrades to a plain text field (#2015, the TUI twin of #1928).
    const property = normalizeNullableUnion(
      (typeof prop === "object" && prop !== null
        ? prop
        : {}) as JsonSchemaProperty,
    );
    const baseField = {
      name: key,
      label: property.title || key,
      required: optional ? false : required.includes(key),
    };

    let field: FormField;

    // A `const` admits exactly one value, and ink-form has no read-only field —
    // so it is rendered as a select with that single option, which the user
    // cannot change (#2123). `decodeFormValues` restores the schema's own typed
    // value on submit, since a select hands back a string.
    const pinned = property.const;
    if (pinned !== undefined) {
      fields.push({
        type: "select",
        ...baseField,
        // Only a REQUIRED constant is pre-filled. `const` constrains a present
        // value; it neither requires the property nor acts as a default, so an
        // optional `dryRun: { const: true }` must stay omittable rather than
        // being sent on every call. The single option is still there for a user
        // who wants it.
        ...(required.includes(key) ? { initialValue: String(pinned) } : {}),
        // Never required: the one option may legitimately be the empty string,
        // which ink-form's required gate can never accept — submission would
        // not even reach `decodeFormValues`, which reapplies the constant. The
        // value is fixed by the schema, and `missingRequiredFields` still
        // validates the decoded call.
        required: false,
        options: [{ label: String(pinned), value: String(pinned) }],
      } as FormField);
      continue;
    }

    // Handle enum -> select. Detect the array-of-enums case on `items.enum`
    // alone (matching the web SchemaForm guard) — a standard array-of-enums
    // schema carries no top-level `enum`, so gating on it would drop the field
    // to a plain string input.
    if (property.type === "array" && property.items?.enum) {
      // ink-form has no multiselect, so we render a single select.
      field = {
        type: "select",
        ...baseField,
        options: toSelectOptions(property.items.enum, property.items.enumNames),
      } as FormField;
    } else if (isStringEnum(property.enum)) {
      // Single select. Gated on the members being strings because
      // `toSelectOptions` stringifies them and ink-form hands the string
      // straight back: a numeric `enum: [1, 2]` would submit `"1"` and violate
      // the schema. A typed non-string enum falls through to its typed field
      // below, which loses the enum constraint but keeps the value's type —
      // the safer of the two losses.
      field = {
        type: "select",
        ...baseField,
        /* v8 ignore next -- guarded by `isStringEnum(property.enum)` above */
        options: toSelectOptions(property.enum ?? [], property.enumNames),
      } as FormField;
    } else {
      // Map JSON Schema types to ink-form types
      switch (property.type) {
        case "string":
          field = {
            type: "string",
            ...baseField,
          } as FormField;
          break;
        case "integer":
          field = {
            type: "integer",
            ...baseField,
            ...(property.minimum !== undefined && { min: property.minimum }),
            ...(property.maximum !== undefined && { max: property.maximum }),
          } as FormField;
          break;
        case "number":
          field = {
            type: "float",
            ...baseField,
            ...(property.minimum !== undefined && { min: property.minimum }),
            ...(property.maximum !== undefined && { max: property.maximum }),
          } as FormField;
          break;
        case "boolean":
          field = {
            type: "boolean",
            ...baseField,
          } as FormField;
          break;
        default:
          // Default to string for unknown types
          field = {
            type: "string",
            ...baseField,
          } as FormField;
      }
    }

    // Set initial value from default (ink-form FormField allows initialValue for some types).
    // A `const` never reaches here — it was rendered as its own one-option
    // select above, which is also why `default` needs no precedence rule.
    if (property.default !== undefined) {
      (field as FormField & { initialValue?: unknown }).initialValue =
        property.default;
    }

    fields.push(field);
  }

  return fields;
}

/**
 * The required fields the chosen shape does not supply — what a static form
 * cannot enforce for itself.
 *
 * A branch's fields are rendered optional because only one alternative applies
 * to a call and ink-form would otherwise demand every branch's, deadlocking the
 * form. That makes the *form* satisfiable, not the call: selecting `email` and
 * leaving `address` empty still violates the schema. So the requirement is
 * checked at submit instead, against the branch the variant select names, and
 * the caller reports it rather than sending a call known to be invalid.
 *
 * Takes the **decoded** values — what would actually be sent.
 */
export function missingRequiredFields(
  schema: JsonSchemaObject | null | undefined,
  decoded: Record<string, unknown>,
  rawValues: Record<string, unknown> = {},
): string[] {
  const { base, branches } = resolveRootUnion(schema ?? {});
  const effective =
    branches.length === 0
      ? base
      : branches[selectedBranchIndex(base, branches, rawValues)]!.schema;
  const properties = effective.properties ?? {};
  const required = Array.isArray(effective.required) ? effective.required : [];
  return required.filter((name) => {
    // `hasOwn` first: an argument legally named `constructor` would otherwise
    // resolve to the inherited one and read as supplied, and the call would go
    // out without it.
    if (!Object.hasOwn(decoded, name)) return true;
    const value = decoded[name];
    if (value === null) {
      // `null` counts as supplied only where the schema admits it — the same
      // test the web gate applies. A branch field is rendered optional here, so
      // a `default: null` on a non-nullable one reaches this check and would
      // otherwise send a value the schema rejects.
      const property = properties[name];
      return (
        typeof property !== "object" ||
        property === null ||
        !admitsNull(property)
      );
    }
    if (value === "") {
      // A branch may pin its discriminator to the empty string, and the
      // one-option control cannot produce anything else — reporting the seeded
      // value as missing would make that branch permanently uncallable.
      return constOf(properties[name]) !== "";
    }
    return value === undefined;
  });
}
