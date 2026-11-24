/**
 * Validate a delivered occurrence's `data` against its event type's
 * `payloadSchema` (SEP-3415, #3029), flagging rather than refusing — the same
 * contract `core/mcp/toolOutputValidation.ts` gives a tool's `outputSchema`.
 *
 * An Inspector shows what the server sent. An occurrence that does not match
 * its declared schema is still delivered and logged; the mismatch rides along
 * as a message, so a server author sees both the payload and what is wrong
 * with it. A schema the validator cannot compile produces no flag at all,
 * because a broken schema is not evidence against the payload.
 *
 * Compiled validators are cached per schema object. A subscription delivers
 * many occurrences against one descriptor, and the cache is keyed weakly, so a
 * re-listed descriptor (a new object) gets a fresh validator and the old one
 * is collectable.
 */

import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";
import type { EventType } from "./schemas.js";

/** Returns a message when `data` violates the type's schema, else `undefined`. */
export type EventPayloadValidator = (
  eventType: EventType,
  data: unknown,
) => string | undefined;

/** A schema the provider failed to compile: never flags. */
const UNCHECKABLE = Symbol("uncheckable");

export function createEventPayloadValidator(
  provider: jsonSchemaValidator,
): EventPayloadValidator {
  const cache = new WeakMap<
    object,
    JsonSchemaValidator<unknown> | typeof UNCHECKABLE
  >();
  return (eventType, data) => {
    const schema = eventType.payloadSchema;
    if (!schema) return undefined;
    let validate = cache.get(schema);
    if (validate === undefined) {
      try {
        // `payloadSchema` is decoded as a plain JSON object; the provider takes
        // its own JSON Schema interface. The two are structurally compatible but
        // nominally unrelated, as for a tool's `outputSchema`.
        validate = provider.getValidator(schema as JsonSchemaType);
      } catch {
        validate = UNCHECKABLE;
      }
      cache.set(schema, validate);
    }
    if (validate === UNCHECKABLE) return undefined;
    const result = validate(data);
    return result.valid
      ? undefined
      : `Payload does not match the payloadSchema of "${eventType.name}": ${result.errorMessage}`;
  };
}
