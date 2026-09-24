/**
 * Interactive terminal renderer for a form-mode elicitation
 * (dual-era support, phase 3). Prompts once per field (type-appropriate:
 * text, numeric, y/n, numbered single-select, numbered multi-select),
 * pre-fills defaults, does light client-side validation (required/length/
 * range), then shows a review step before submitting so the user can
 * re-edit any field or cancel outright.
 */
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { Style } from "@inspector/cli/style.js";
import type { FormField } from "./form-schema.js";
import { sanitizeText } from "./sanitize.js";

export type FormOutcome =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

/**
 * A promise that rejects the first time `rl`'s underlying input stream
 * closes (EOF on a redirected/piped stdin, or the readline interface being
 * closed elsewhere). Racing every `rl.question()` against this means a
 * closed-before-answered stdin (e.g. `mcpdo ... </dev/null`) falls through
 * to the caller's cancel/decline handling instead of hanging forever
 * waiting for a line that will never arrive.
 */
export function watchForClose(rl: ReadlineInterface): Promise<never> {
  return new Promise((_, reject) => {
    rl.once("close", () =>
      reject(new Error("stdin closed before an answer was given")),
    );
  });
}

/** `rl.question()`, but rejects instead of hanging if stdin closes first. */
function ask(
  rl: ReadlineInterface,
  closed: Promise<never>,
  prompt: string,
): Promise<string> {
  return Promise.race([rl.question(prompt), closed]);
}

function formatDefault(field: FormField): string | undefined {
  if (field.default === undefined) return undefined;
  if (field.kind === "multiselect") {
    return (field.default as string[]).join(", ");
  }
  return String(field.default);
}

function describeField(field: FormField, style: Style): string {
  // Titles, descriptions and defaults are server-controlled: sanitize at the
  // render point only, so the raw values still travel in the response.
  const req = field.required ? style.yellow(" (required)") : "";
  const desc = field.description ? ` — ${sanitizeText(field.description)}` : "";
  const def = formatDefault(field);
  const defHint =
    def !== undefined ? style.dim(` [default: ${sanitizeText(def)}]`) : "";
  return `${style.bold(sanitizeText(field.title))}${req}${desc}${defHint}`;
}

/** Prompts for one field's value; loops until a valid answer or a default/blank-when-optional. */
async function promptField(
  rl: ReadlineInterface,
  closed: Promise<never>,
  field: FormField,
  style: Style,
): Promise<unknown> {
  for (;;) {
    if (field.kind === "boolean") {
      const def = field.default;
      const hint = def === undefined ? "y/n" : def ? "Y/n" : "y/N";
      const raw = (
        await ask(rl, closed, `${describeField(field, style)}\n  [${hint}]: `)
      )
        .trim()
        .toLowerCase();
      if (raw === "" && def !== undefined) return def;
      if (raw === "y" || raw === "yes") return true;
      if (raw === "n" || raw === "no") return false;
      if (raw === "" && !field.required) return undefined;
      process.stderr.write(style.red("  Please answer y or n.\n"));
      continue;
    }

    if (field.kind === "enum" || field.kind === "multiselect") {
      const lines = field.choices.map(
        (choice, i) => `    ${i + 1}. ${sanitizeText(choice.label)}`,
      );
      const multi = field.kind === "multiselect";
      const prompt = multi
        ? "Enter one or more numbers separated by commas"
        : "Enter a number";
      const raw = (
        await ask(
          rl,
          closed,
          `${describeField(field, style)}\n${lines.join("\n")}\n  ${prompt}: `,
        )
      ).trim();
      if (raw === "") {
        if (field.default !== undefined) return field.default;
        if (!field.required) return undefined;
        process.stderr.write(style.red("  This field is required.\n"));
        continue;
      }
      // Strict whole-token integers only: parseInt would accept "1abc" as 1,
      // silently submitting a different answer than the user typed.
      const tokens = raw.split(",").map((s) => s.trim());
      const indices = tokens.map((s) =>
        /^\d+$/.test(s) ? Number.parseInt(s, 10) : Number.NaN,
      );
      if (
        indices.some(
          (n) => !Number.isInteger(n) || n < 1 || n > field.choices.length,
        )
      ) {
        process.stderr.write(
          style.red(
            `  Enter a number between 1 and ${field.choices.length}.\n`,
          ),
        );
        continue;
      }
      if (!multi && indices.length !== 1) {
        // "1,2" on a single-select would silently drop everything after the
        // first choice — re-prompt instead.
        process.stderr.write(style.red("  Enter exactly one number.\n"));
        continue;
      }
      const values = indices.map((n) => field.choices[n - 1]!.value);
      if (multi) {
        const m = field as Extract<FormField, { kind: "multiselect" }>;
        if (m.minItems !== undefined && values.length < m.minItems) {
          process.stderr.write(style.red(`  Select at least ${m.minItems}.\n`));
          continue;
        }
        if (m.maxItems !== undefined && values.length > m.maxItems) {
          process.stderr.write(style.red(`  Select at most ${m.maxItems}.\n`));
          continue;
        }
        return values;
      }
      return values[0];
    }

    if (field.kind === "number") {
      const def = field.default;
      const raw = (
        await ask(
          rl,
          closed,
          `${describeField(field, style)}\n  ${def !== undefined ? `[${def}]` : ""}: `,
        )
      ).trim();
      if (raw === "") {
        if (def !== undefined) return def;
        if (!field.required) return undefined;
        process.stderr.write(style.red("  This field is required.\n"));
        continue;
      }
      const n = Number(raw);
      if (
        // isFinite (not isNaN): "Infinity" is not a valid JSON number and
        // would serialize as null in the response frame.
        !Number.isFinite(n) ||
        (field.integer && !Number.isInteger(n)) ||
        (field.minimum !== undefined && n < field.minimum) ||
        (field.maximum !== undefined && n > field.maximum)
      ) {
        const range =
          field.minimum !== undefined || field.maximum !== undefined
            ? ` (${field.minimum ?? "-∞"}..${field.maximum ?? "∞"})`
            : "";
        process.stderr.write(
          style.red(
            `  Enter a valid ${field.integer ? "integer" : "number"}${range}.\n`,
          ),
        );
        continue;
      }
      return n;
    }

    // string
    const def = field.default;
    const raw = await ask(
      rl,
      closed,
      `${describeField(field, style)}\n  ${def !== undefined ? `[${sanitizeText(def)}]` : ""}: `,
    );
    const value = raw === "" && def !== undefined ? def : raw;
    if (value === "" && field.required) {
      process.stderr.write(style.red("  This field is required.\n"));
      continue;
    }
    if (value === "" && !field.required) return undefined;
    if (field.minLength !== undefined && value.length < field.minLength) {
      process.stderr.write(
        style.red(`  Must be at least ${field.minLength} characters.\n`),
      );
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      process.stderr.write(
        style.red(`  Must be at most ${field.maxLength} characters.\n`),
      );
      continue;
    }
    return value;
  }
}

/**
 * Collect one value per field, then loop on a review step (submit / edit a
 * field by name / cancel) until the user submits or cancels.
 */
export async function promptForm(
  rl: ReadlineInterface,
  message: string,
  fields: FormField[],
  style: Style,
): Promise<FormOutcome> {
  process.stderr.write(`\n${style.bold("Input requested: ")}${message}\n\n`);
  const closed = watchForClose(rl);

  const values = new Map<string, unknown>();
  for (const field of fields) {
    values.set(field.name, await promptField(rl, closed, field, style));
  }

  for (;;) {
    process.stderr.write(`\n${style.bold("Review your answers:")}\n`);
    for (const field of fields) {
      const v = values.get(field.name);
      process.stderr.write(
        `  ${sanitizeText(field.title)}: ${v === undefined ? style.dim("(none)") : sanitizeText(String(v))}\n`,
      );
    }
    const answer = (
      await ask(
        rl,
        closed,
        "\nPress Enter to submit, type a field name to edit it, or 'c' to cancel: ",
      )
    ).trim();
    if (answer === "") {
      const content: Record<string, unknown> = {};
      for (const field of fields) {
        const v = values.get(field.name);
        if (v !== undefined) content[field.name] = v;
      }
      return { action: "accept", content };
    }
    if (answer.toLowerCase() === "c") {
      return { action: "cancel" };
    }
    const field = fields.find((f) => f.name === answer);
    if (!field) {
      process.stderr.write(
        style.red(`  Unknown field "${answer}". Try again.\n`),
      );
      continue;
    }
    values.set(field.name, await promptField(rl, closed, field, style));
  }
}
