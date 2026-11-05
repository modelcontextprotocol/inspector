/**
 * Pure helpers behind the TUI's pending-request modal (#2829): what a
 * server-initiated `sampling/createMessage` or `elicitation/create` looks like
 * on screen, the ink-form structures that answer one, and the conversion from
 * submitted form values back into the result the server expects.
 *
 * The queue itself, and the `respond()` / `reject()` that settle an entry, are
 * core's (`InspectorClient.getPendingSamples` / `getPendingElicitations`, read
 * through `usePendingClientRequests`) — the same plumbing the web client's
 * `PendingClientRequestModal` drives. Only the terminal presentation is here.
 *
 * Pure by design (utils = compute): the component that renders these is
 * `components/PendingRequestModal.tsx`.
 */

import type { FormStructure } from "ink-form";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
} from "@modelcontextprotocol/client";
import {
  decodeFormValues,
  missingRequiredFields,
  schemaToForm,
} from "./schemaToForm.js";

type SamplingParams = CreateMessageRequest["params"];
type ElicitParams = ElicitRequest["params"];
/** The form-mode half of `elicitation/create`'s params. */
export type ElicitFormParams = Exclude<ElicitParams, { mode: "url" }>;
type RequestedSchema = ElicitFormParams["requestedSchema"];

/** The stop reasons the sampling form offers, in the order shown. */
export const SAMPLING_STOP_REASONS = [
  "endTurn",
  "stopSequence",
  "maxTokens",
] as const;

/** The model name pre-filled into a sampling response, as the web client does. */
export const DEFAULT_SAMPLING_MODEL = "stub-model";

/**
 * The form that answers a sampling request: the assistant's reply text, the
 * model it claims to come from, and why it stopped. Role is always
 * `assistant` — a sampling result is the model's turn by definition.
 */
export const SAMPLING_RESPONSE_FORM: FormStructure = {
  sections: [
    {
      title: "Response",
      fields: [
        { type: "string", name: "text", label: "Response text" },
        {
          type: "string",
          name: "model",
          label: "Model",
          required: true,
          initialValue: DEFAULT_SAMPLING_MODEL,
        },
        {
          type: "select",
          name: "stopReason",
          label: "Stop reason",
          required: true,
          initialValue: "endTurn",
          options: SAMPLING_STOP_REASONS.map((reason) => ({
            label: reason,
            value: reason,
          })),
        },
      ],
    },
  ],
};

/** Build the `sampling/createMessage` result a submitted response form describes. */
export function samplingResultFromForm(
  values: Record<string, unknown>,
): CreateMessageResult {
  const text = typeof values.text === "string" ? values.text : "";
  const model =
    typeof values.model === "string" && values.model.trim() !== ""
      ? values.model.trim()
      : DEFAULT_SAMPLING_MODEL;
  const stopReason =
    typeof values.stopReason === "string" ? values.stopReason : "endTurn";
  return {
    role: "assistant",
    model,
    stopReason,
    content: { type: "text", text },
  };
}

/** One content block of a sampling message, as a single line of text. */
function describeBlock(block: unknown): string {
  if (typeof block !== "object" || block === null) return String(block);
  const typed = block as {
    type?: unknown;
    text?: unknown;
    mimeType?: unknown;
    name?: unknown;
  };
  if (typed.type === "text" && typeof typed.text === "string") {
    return typed.text;
  }
  if (typeof typed.mimeType === "string") {
    return `[${String(typed.type)}: ${typed.mimeType}]`;
  }
  if (typeof typed.name === "string") {
    return `[${String(typed.type)}: ${typed.name}]`;
  }
  return `[${String(typed.type ?? "unknown")}]`;
}

/**
 * The sampling request as lines of text for the modal: its system prompt and
 * token budget, any model hints, then each message as `role: content`. A
 * multi-line text block keeps its line breaks, indented under its role.
 */
export function describeSamplingRequest(params: SamplingParams): string[] {
  const lines: string[] = [];
  if (params.systemPrompt) lines.push(`System prompt: ${params.systemPrompt}`);
  lines.push(`Max tokens: ${params.maxTokens}`);
  const hints = (params.modelPreferences?.hints ?? [])
    .map((hint) => hint.name)
    .filter((name): name is string => typeof name === "string");
  if (hints.length > 0) lines.push(`Model hints: ${hints.join(", ")}`);
  lines.push("");
  for (const message of params.messages) {
    const blocks: unknown[] = Array.isArray(message.content)
      ? message.content
      : [message.content];
    const text = blocks.map(describeBlock).join(" ");
    const [first = "", ...rest] = text.split("\n");
    lines.push(`${message.role}: ${first}`);
    for (const line of rest) lines.push(`  ${line}`);
  }
  return lines;
}

/** A `{ const, title }` option list, as elicitation's titled enums declare. */
function constOptions(
  members: unknown,
): { values: string[]; names: string[] } | undefined {
  if (!Array.isArray(members) || members.length === 0) return undefined;
  const values: string[] = [];
  const names: string[] = [];
  for (const member of members) {
    if (typeof member !== "object" || member === null) return undefined;
    const { const: value, title } = member as {
      const?: unknown;
      title?: unknown;
    };
    if (typeof value !== "string") return undefined;
    values.push(value);
    names.push(typeof title === "string" ? title : value);
  }
  return { values, names };
}

/**
 * Rewrite elicitation's titled enums into the `enum` + `enumNames` shape the
 * tool form already renders as a select.
 *
 * The elicitation schema declares a titled single-select as
 * `{ type: "string", oneOf: [{ const, title }] }` and a titled multi-select as
 * `{ type: "array", items: { anyOf: [{ const, title }] } }`. `schemaToForm`
 * reads neither — it was written for tool input schemas — so without this a
 * titled choice would degrade to free text the user could fill with a value
 * the server rejects.
 */
export function normalizeElicitationSchema(
  schema: RequestedSchema,
): RequestedSchema {
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      const { oneOf, items, ...rest } = property as Record<string, unknown> & {
        oneOf?: unknown;
        items?: { anyOf?: unknown; enum?: unknown };
      };
      const single = constOptions(oneOf);
      if (single) {
        return [
          name,
          { ...rest, enum: single.values, enumNames: single.names },
        ];
      }
      const multi = constOptions(items?.anyOf);
      if (multi) {
        return [
          name,
          {
            ...rest,
            items: { enum: multi.values, enumNames: multi.names },
          },
        ];
      }
      return [name, property];
    }),
  );
  return { ...schema, properties } as RequestedSchema;
}

/** The ink-form structure for a form-mode elicitation's requested schema. */
export function elicitationForm(schema: RequestedSchema): FormStructure {
  // `schemaToForm` always returns its "Parameters" section first; renamed,
  // since here the fields are the user's answer rather than a call's input.
  // No title: the modal's own header names the request.
  const [first, ...rest] = schemaToForm(
    normalizeElicitationSchema(schema),
    "elicitation",
  ).sections;
  return { sections: [{ ...first!, title: "Response" }, ...rest] };
}

/**
 * Turn a submitted elicitation form into the `accept` result, or report the
 * required fields it leaves empty.
 *
 * Unfilled optional fields are dropped rather than sent as `undefined`, and a
 * multi-select — which ink-form can only render as a single select — is sent
 * as the one-element array the schema's `type: "array"` demands.
 */
export function elicitationContentFromForm(
  schema: RequestedSchema,
  rawValues: Record<string, unknown>,
): { result: ElicitResult } | { missing: string[] } {
  const normalized = normalizeElicitationSchema(schema);
  const decoded = decodeFormValues(normalized, rawValues);
  const missing = missingRequiredFields(normalized, decoded, rawValues);
  if (missing.length > 0) return { missing };
  // Built through `fromEntries` rather than by assignment: `__proto__` is a
  // legal property name, and assigning it would invoke the legacy prototype
  // setter — the answer would pass the required check and then vanish.
  const content: NonNullable<ElicitResult["content"]> = Object.fromEntries(
    Object.entries(decoded)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => {
        const property = normalized.properties[name] as
          | { type?: unknown }
          | undefined;
        return [
          name,
          property?.type === "array" && typeof value === "string"
            ? [value]
            : (value as string | number | boolean | string[]),
        ];
      }),
  );
  return { result: { action: "accept", content } };
}

/**
 * Rows to give an elicitation message above its form: its wrapped height, but
 * never more than a third of the terminal, so a long message scrolls instead
 * of pushing the response fields and Submit out of the modal. Always at least
 * one row.
 *
 * @param columns - the text width available inside the modal
 * @param terminalRows - the terminal's height
 */
export function messageBoxHeight(
  message: string,
  columns: number,
  terminalRows: number,
): number {
  const perRow = Math.max(1, columns);
  const wrapped = message
    .split("\n")
    .reduce(
      (rows, line) => rows + Math.max(1, Math.ceil(line.length / perRow)),
      0,
    );
  return Math.max(1, Math.min(wrapped, Math.floor(terminalRows / 3)));
}

/**
 * Why a server-supplied elicitation URL may not be opened, or `undefined` when
 * it may. Only http(s) is handed to the browser opener — the same allowlist the
 * web client applies, since a `file:` or `javascript:` URL here is
 * server-controlled input.
 */
export function elicitationUrlRefusal(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") return undefined;
  } catch {
    // Unparseable: refused below like any other non-http(s) URL.
  }
  return "Refusing to open this URL: only http: and https: URLs can be opened from an elicitation request.";
}
