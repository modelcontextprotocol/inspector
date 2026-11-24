/**
 * The Events tab's subscribe dialog (#3032): pick poll or push delivery and
 * fill in the event type's arguments, then hand both to `onSubscribe`.
 *
 * Thin by design. The form comes from `eventSubscribeForm` (the same
 * schema-to-form conversion the tool modal uses), and subscribing is the
 * caller's: `App` passes the shared engine's `subscribe`, which throws for a
 * subscription the connection cannot run. A refusal is shown here and the
 * dialog stays open; a success closes it, and the subscription's progress is
 * the Events tab's to show.
 */
import React, { useMemo, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import { GatedForm } from "./GatedForm.js";
import { FORM_FIELD_MANAGERS } from "./MultiSelectField.js";
import { untitledForm } from "../utils/formHeader.js";
import {
  decodeSubscribeValues,
  eventSubscribeForm,
  type TuiDeliveryMode,
} from "../utils/eventSubscribeForm.js";
import { errorMessage } from "../utils/errorText.js";

interface EventSubscribeModalProps {
  eventType: EventType;
  width: number;
  height: number;
  /** Start the subscription; throw to refuse it. */
  onSubscribe: (
    eventType: EventType,
    mode: TuiDeliveryMode,
    args: Record<string, JsonValue>,
  ) => void;
  onClose: () => void;
  /** False while a pending server request owns the keyboard (#2829). */
  inputActive?: boolean;
}

export function EventSubscribeModal({
  eventType,
  width,
  height,
  onSubscribe,
  onClose,
  inputActive = true,
}: EventSubscribeModalProps) {
  const built = useMemo(() => eventSubscribeForm(eventType), [eventType]);
  const [error, setError] = useState<string | null>(null);

  useInput(
    (_input: string, key: Key) => {
      if (key.escape) onClose();
    },
    { isActive: inputActive },
  );

  const handleSubmit = (rawValues: Record<string, JsonValue>): void => {
    // `built` is non-null whenever the form is rendered.
    const decoded = decodeSubscribeValues(eventType, built!, rawValues);
    if (!decoded.ok) {
      setError(decoded.error);
      return;
    }
    try {
      onSubscribe(eventType, decoded.mode, decoded.arguments);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={width - 2}
        height={height - 2}
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor="black"
      >
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            Subscribe: {eventType.name}
          </Text>
          <Text> </Text>
          <Text dimColor>(Press ESC to close)</Text>
        </Box>
        {error && (
          <Box flexShrink={0} marginBottom={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {built ? (
            <GatedForm
              form={untitledForm(built.form)}
              active={inputActive}
              customManagers={FORM_FIELD_MANAGERS}
              onSubmit={(value: object) =>
                handleSubmit(value as Record<string, JsonValue>)
              }
            />
          ) : (
            <Text dimColor>
              {`${eventType.name} is delivered by ${eventType.delivery.join(", ")} only; the TUI subscribes with poll or push.`}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
