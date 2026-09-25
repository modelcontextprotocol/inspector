import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStyle } from "@inspector/cli/style.js";
import { promptForm } from "../src/connection/form-prompt.js";
import type { FormField } from "../src/connection/form-schema.js";

/**
 * Covers `promptForm`'s field-by-field prompting (one branch per
 * `FormField.kind`, including validation retry loops and defaults) and the
 * review step (submit / edit-by-name / cancel).
 */
describe("promptForm", () => {
  let stderr: string;
  let originalWrite: typeof process.stderr.write;
  const style = createStyle(false);

  beforeEach(() => {
    stderr = "";
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  function fakeRl(answers: string[]) {
    let i = 0;
    const closeHandlers: Array<() => void> = [];
    return {
      question: vi.fn(async () => {
        const answer = answers[i];
        i += 1;
        if (answer === undefined) {
          throw new Error("no more scripted answers");
        }
        return answer;
      }),
      once: vi.fn((event: string, cb: () => void) => {
        if (event === "close") closeHandlers.push(cb);
      }),
      // Test-only hook: simulates the underlying stdin closing (e.g. a
      // redirected/piped input hitting EOF) so we can exercise the
      // watchForClose() race without a real stream.
      __triggerClose: () => closeHandlers.forEach((cb) => cb()),
    } as unknown as Parameters<typeof promptForm>[0] & {
      __triggerClose: () => void;
    };
  }

  const stringField: FormField = {
    name: "name",
    required: true,
    title: "Name",
    kind: "string",
  };

  it("collects a required string field and submits on blank review answer", async () => {
    const rl = fakeRl(["octocat", ""]);
    const outcome = await promptForm(
      rl,
      "Enter your name",
      [stringField],
      style,
    );
    expect(outcome).toEqual({ action: "accept", content: { name: "octocat" } });
    expect(stderr).toContain("Enter your name");
  });

  it("re-prompts a required string field left blank, then accepts a default", async () => {
    const field: FormField = {
      ...stringField,
      required: false,
      default: "anon",
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "anon" } });
  });

  it("omits an optional string field left blank with no default", async () => {
    const field: FormField = { ...stringField, required: false };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: {} });
  });

  it("accepts a blank answer for a required string field as an empty string", async () => {
    // JSON Schema `required` means present, not non-empty.
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [stringField], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "" } });
    expect(stderr).not.toContain("This field is required");
  });

  it("lets minLength reject a blank required answer", async () => {
    const field: FormField = { ...stringField, minLength: 3 };
    const rl = fakeRl(["", "abc", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "abc" } });
    expect(stderr).toContain("at least 3");
  });

  it("keeps an empty-string default instead of dropping the field", async () => {
    const field: FormField = { ...stringField, required: false, default: "" };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "" } });
  });

  it("enforces minLength/maxLength on a string field", async () => {
    const field: FormField = { ...stringField, minLength: 3, maxLength: 5 };
    const rl = fakeRl(["ab", "toolong", "oka", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "oka" } });
    expect(stderr).toContain("at least 3");
    expect(stderr).toContain("at most 5");
  });

  it("collects a required number field with range validation", async () => {
    const field: FormField = {
      name: "age",
      required: true,
      title: "Age",
      kind: "number",
      integer: false,
      minimum: 18,
      maximum: 100,
    };
    const rl = fakeRl(["notanumber", "5", "30", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { age: 30 } });
    expect(stderr).toContain("Enter a valid number");
  });

  it("rejects a non-integer value for an integer field", async () => {
    const field: FormField = {
      name: "count",
      required: true,
      title: "Count",
      kind: "number",
      integer: true,
    };
    const rl = fakeRl(["1.5", "3", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { count: 3 } });
    expect(stderr).toContain("Enter a valid integer");
  });

  it("uses a number field's default on blank, or omits when optional with none", async () => {
    const withDefault: FormField = {
      name: "age",
      required: false,
      title: "Age",
      kind: "number",
      integer: false,
      default: 21,
    };
    const rl1 = fakeRl(["", ""]);
    expect(await promptForm(rl1, "msg", [withDefault], style)).toEqual({
      action: "accept",
      content: { age: 21 },
    });

    const noDefault: FormField = {
      name: "age",
      required: false,
      title: "Age",
      kind: "number",
      integer: false,
    };
    const rl2 = fakeRl(["", ""]);
    expect(await promptForm(rl2, "msg", [noDefault], style)).toEqual({
      action: "accept",
      content: {},
    });
  });

  it("re-prompts a required number field left blank", async () => {
    const field: FormField = {
      name: "age",
      required: true,
      title: "Age",
      kind: "number",
      integer: false,
    };
    const rl = fakeRl(["", "42", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { age: 42 } });
  });

  it("collects a boolean field via y/n, defaulting on blank", async () => {
    const field: FormField = {
      name: "confirm",
      required: false,
      title: "Confirm",
      kind: "boolean",
      default: true,
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { confirm: true } });
  });

  it("re-prompts on an invalid boolean answer and accepts yes/no variants", async () => {
    const field: FormField = {
      name: "confirm",
      required: true,
      title: "Confirm",
      kind: "boolean",
    };
    const rl = fakeRl(["maybe", "yes", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { confirm: true } });
    expect(stderr).toContain("Please answer y or n");

    const rl2 = fakeRl(["no", ""]);
    expect(
      await promptForm(rl2, "msg", [{ ...field, required: false }], style),
    ).toEqual({ action: "accept", content: { confirm: false } });
  });

  it("omits an optional boolean field left blank with no default", async () => {
    const field: FormField = {
      name: "confirm",
      required: false,
      title: "Confirm",
      kind: "boolean",
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: {} });
  });

  it("collects a single-select enum by number, and accepts a default on blank", async () => {
    const field: FormField = {
      name: "color",
      required: true,
      title: "Color",
      kind: "enum",
      choices: [
        { value: "red", label: "Red" },
        { value: "blue", label: "Blue" },
      ],
    };
    const rl = fakeRl(["2", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { color: "blue" } });

    const withDefault: FormField = { ...field, default: "red" };
    const rl2 = fakeRl(["", ""]);
    expect(await promptForm(rl2, "msg", [withDefault], style)).toEqual({
      action: "accept",
      content: { color: "red" },
    });
  });

  it("re-prompts on an out-of-range enum choice and a required blank", async () => {
    const field: FormField = {
      name: "color",
      required: true,
      title: "Color",
      kind: "enum",
      choices: [{ value: "red", label: "Red" }],
    };
    const rl = fakeRl(["", "9", "1", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { color: "red" } });
    expect(stderr).toContain("This field is required");
    expect(stderr).toContain("Enter a number between 1 and 1");
  });

  it("rejects malformed and multi-token single-select answers", async () => {
    const field: FormField = {
      name: "color",
      required: true,
      title: "Color",
      kind: "enum",
      choices: [
        { value: "red", label: "Red" },
        { value: "blue", label: "Blue" },
      ],
    };
    // "1abc" must not be silently accepted as choice 1 (parseInt prefix),
    // and "1,2" on a single-select must not silently submit only "red".
    const rl = fakeRl(["1abc", "1,2", "2", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { color: "blue" } });
    expect(stderr).toContain("Enter a number between 1 and 2");
    expect(stderr).toContain("Enter exactly one number");
  });

  it("omits an optional enum field left blank with no default", async () => {
    const field: FormField = {
      name: "color",
      required: false,
      title: "Color",
      kind: "enum",
      choices: [{ value: "red", label: "Red" }],
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: {} });
  });

  it("collects a multi-select enum via comma-separated numbers, enforcing minItems/maxItems", async () => {
    const field: FormField = {
      name: "colors",
      required: true,
      title: "Colors",
      kind: "multiselect",
      choices: [
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ],
      minItems: 1,
      maxItems: 2,
    };
    const rl = fakeRl(["1,2,3", "1,2", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({
      action: "accept",
      content: { colors: ["red", "green"] },
    });
    expect(stderr).toContain("Select at most 2");
  });

  it("enforces minItems on a multi-select enum", async () => {
    const field: FormField = {
      name: "colors",
      required: true,
      title: "Colors",
      kind: "multiselect",
      choices: [
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
      ],
      minItems: 2,
    };
    const rl = fakeRl(["1", "1,2", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({
      action: "accept",
      content: { colors: ["red", "green"] },
    });
    expect(stderr).toContain("Select at least 2");
  });

  it("uses a multi-select default on blank, formatted in the field description", async () => {
    const field: FormField = {
      name: "colors",
      required: false,
      title: "Colors",
      kind: "multiselect",
      choices: [{ value: "red", label: "Red" }],
      default: ["red"],
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: { colors: ["red"] } });
    expect(
      (rl.question as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("[default: red]");
  });

  it("omits an optional multi-select field left blank with no default", async () => {
    const field: FormField = {
      name: "colors",
      required: false,
      title: "Colors",
      kind: "multiselect",
      choices: [{ value: "red", label: "Red" }],
    };
    const rl = fakeRl(["", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({ action: "accept", content: {} });
  });

  it("shows a description when the field has one", async () => {
    const field: FormField = {
      ...stringField,
      description: "Your full display name",
    };
    const rl = fakeRl(["octocat", ""]);
    await promptForm(rl, "msg", [field], style);
    expect(
      (rl.question as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain("Your full display name");
  });

  it("cancels from the review step", async () => {
    const rl = fakeRl(["octocat", "c"]);
    const outcome = await promptForm(rl, "msg", [stringField], style);
    expect(outcome).toEqual({ action: "cancel" });
  });

  it("re-prompts a review answer that doesn't name a known field", async () => {
    const rl = fakeRl(["octocat", "bogus", "c"]);
    const outcome = await promptForm(rl, "msg", [stringField], style);
    expect(outcome).toEqual({ action: "cancel" });
    expect(stderr).toContain('Unknown field "bogus"');
  });

  it("lets the review step re-edit a named field before submitting", async () => {
    const rl = fakeRl(["octocat", "name", "edited", ""]);
    const outcome = await promptForm(rl, "msg", [stringField], style);
    expect(outcome).toEqual({ action: "accept", content: { name: "edited" } });
  });

  it("shows the property name in the review when it differs from the title, and edits by title", async () => {
    const field: FormField = {
      name: "emailAddress",
      required: true,
      title: "Email address",
      kind: "string",
    };
    // Initial value, edit via the display title, new value, submit.
    const rl = fakeRl(["a@example.com", "Email address", "b@example.com", ""]);
    const outcome = await promptForm(rl, "msg", [field], style);
    expect(outcome).toEqual({
      action: "accept",
      content: { emailAddress: "b@example.com" },
    });
    // The review label must reveal the editable property name.
    expect(stderr).toContain("Email address (emailAddress):");
  });

  it("shows '(none)' in the review for a field with no value", async () => {
    const field: FormField = { ...stringField, required: false };
    const rl = fakeRl(["", ""]);
    await promptForm(rl, "msg", [field], style);
    expect(stderr).toContain("(none)");
  });

  it("rejects instead of hanging when stdin closes before an answer arrives", async () => {
    const rl = fakeRl([]);
    (rl.question as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves on its own
    );
    const outcome = promptForm(rl, "msg", [stringField], style);
    (rl as unknown as { __triggerClose: () => void }).__triggerClose();
    await expect(outcome).rejects.toThrow(
      "stdin closed before an answer was given",
    );
  });
});
