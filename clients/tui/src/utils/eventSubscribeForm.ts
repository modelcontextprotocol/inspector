/**
 * The form the TUI's Events tab subscribes with (#3032): the event type's
 * `inputSchema` as fields, plus one select choosing poll or push delivery.
 *
 * Pure (utils = compute): it builds an `ink-form` structure and decodes what
 * the form submitted. The subscribing itself is the shared engine's
 * (`EventSubscriptionsState`), reached from `App`.
 *
 * **The delivery picker lives in the same form as the arguments.** ink-form
 * scopes values by field name across the whole form, so the picker needs a name
 * no argument has. {@link deliveryFieldName} derives one from the generated
 * argument fields rather than reserving a word, since an event type may well
 * declare an argument called `delivery`.
 */

import type { FormField, FormStructure } from "ink-form";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import {
  knownDeliveryModes,
  type EventType,
} from "@inspector/core/extension/events/schemas.js";
import { inlineLocalRefs } from "@inspector/core/json/localRefs.js";
import {
  decodeFormValues,
  missingRequiredFields,
  schemaToForm,
  selectionCountErrors,
} from "./schemaToForm.js";

/** The delivery modes the TUI runs. Webhook management is #3026 phase 4. */
export type TuiDeliveryMode = "poll" | "push";

/** The modes `eventType` advertises that the TUI can run, poll first. */
export function subscribableModes(eventType: EventType): TuiDeliveryMode[] {
  const advertised = knownDeliveryModes(eventType);
  return (["poll", "push"] as const).filter((mode) =>
    advertised.includes(mode),
  );
}

/**
 * A field name for the delivery picker that no field of the argument form
 * uses. Read from the generated form rather than the schema's root
 * `properties`, so a name the form takes from `allOf` or a union branch is
 * avoided too.
 */
export function deliveryFieldName(argumentsForm: FormStructure): string {
  const taken = new Set(
    argumentsForm.sections.flatMap((section) =>
      section.fields.map((field) => field.name),
    ),
  );
  let name = "delivery";
  while (taken.has(name)) name = `_${name}`;
  return name;
}

export interface EventSubscribeForm {
  form: FormStructure;
  /** The field holding the chosen mode. */
  deliveryField: string;
  modes: TuiDeliveryMode[];
}

/**
 * The subscribe form for `eventType`, or `null` when it advertises no mode the
 * TUI runs (a webhook-only type).
 */
export function eventSubscribeForm(
  eventType: EventType,
): EventSubscribeForm | null {
  const modes = subscribableModes(eventType);
  if (modes.length === 0) return null;
  const schema = inlineLocalRefs(eventType.inputSchema);
  const argumentsForm = schemaToForm(schema, eventType.name);
  const deliveryField = deliveryFieldName(argumentsForm);
  const picker: FormField = {
    type: "select",
    name: deliveryField,
    label: "Delivery",
    required: true,
    initialValue: modes[0],
    options: modes.map((mode) => ({ label: mode, value: mode })),
  } as FormField;
  return {
    form: {
      title: `Subscribe: ${eventType.name}`,
      sections: [
        { title: "Delivery", fields: [picker] },
        ...argumentsForm.sections.map((section) =>
          section.title === "Parameters"
            ? { ...section, title: "Arguments" }
            : section,
        ),
      ],
    },
    deliveryField,
    modes,
  };
}

export type DecodedSubscribe =
  | {
      ok: true;
      mode: TuiDeliveryMode;
      arguments: Record<string, JsonValue>;
    }
  | { ok: false; error: string };

/**
 * Read a submitted form back into a mode and the subscription arguments, with
 * the same required-field check the tool modal applies before calling.
 */
export function decodeSubscribeValues(
  eventType: EventType,
  built: EventSubscribeForm,
  rawValues: Record<string, JsonValue>,
): DecodedSubscribe {
  const { [built.deliveryField]: chosen, ...rest } = rawValues;
  const mode = built.modes.find((candidate) => candidate === chosen);
  if (!mode) {
    return { ok: false, error: "Choose a delivery mode." };
  }
  const schema = inlineLocalRefs(eventType.inputSchema);
  const values = decodeFormValues(schema, rest);
  const missing = missingRequiredFields(schema, values, rest);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    };
  }
  // A multi-select's `minItems` / `maxItems` are invisible to ink-form's own
  // gate, as in the tool modal (#2904).
  const outOfBounds = selectionCountErrors(schema, values, rest);
  if (outOfBounds.length > 0) {
    return {
      ok: false,
      error: `Invalid argument${outOfBounds.length > 1 ? "s" : ""}: ${outOfBounds.join("; ")}`,
    };
  }
  return { ok: true, mode, arguments: values };
}
