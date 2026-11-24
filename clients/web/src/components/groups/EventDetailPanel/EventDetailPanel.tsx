import { useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  Code,
  Divider,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { EventSubscriptionMode } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { DeliveryModeBadge } from "../../elements/DeliveryModeBadge/DeliveryModeBadge";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import {
  hasMissingRequiredFields,
  toFormSchema,
} from "../../../utils/jsonUtils";
import {
  formatPayload,
  mirroredEventHeaders,
  optionalWholeNumber,
  subscribableModes,
  type SubscribeTuning,
} from "../../../utils/eventsUtils";

export interface EventDetailPanelProps {
  eventType: EventType;
  formValues: Record<string, unknown>;
  onFormChange: (values: Record<string, unknown>) => void;
  /**
   * The mode to subscribe with, already resolved against what the type
   * offers; `undefined` when it offers no mode this tab subscribes with.
   */
  mode: EventSubscriptionMode | undefined;
  onModeChange: (mode: EventSubscriptionMode) => void;
  tuning: SubscribeTuning;
  onTuningChange: (tuning: SubscribeTuning) => void;
  onSubscribe: () => void;
  /** Why the last subscribe was refused, shown above the button. */
  subscribeError?: string;
  /** Per-selection identity for the schema form; see `SchemaFormProps`. */
  resetKey?: string;
}

// Header pinned, body scrolls, Subscribe footer pinned — ToolDetailPanel's
// layout, so the form and its action stay in view together.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const PinnedHeader = Stack.withProps({
  gap: "xs",
  flex: "0 0 auto",
});

const BodyScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  scrollbars: "y",
  offsetScrollbars: true,
});

const BodyStack = Stack.withProps({
  gap: "md",
});

const EventTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ModeRow = Group.withProps({
  gap: 4,
});

const SectionTitle = Text.withProps({
  size: "sm",
  fw: 600,
});

const SectionNote = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const HeaderSection = Stack.withProps({
  gap: "xs",
});

// Wraps rather than squeezing a header name into a narrow column.
const HeaderRow = Group.withProps({
  gap: 6,
});

const HeaderArrow = Text.withProps({
  size: "sm",
  c: "var(--inspector-text-secondary)",
});

// The schemas are shown as text, in a block that wraps rather than scrolling
// sideways inside an already narrow column.
const SchemaBlock = Code.withProps({
  block: true,
});

const TuningRow = Group.withProps({
  gap: "sm",
  grow: true,
  align: "flex-start",
});

const TuningInput = NumberInput.withProps({
  min: 0,
  allowDecimal: false,
  allowNegative: false,
  size: "sm",
});

const FooterRow = Group.withProps({
  justify: "flex-start",
  flex: "0 0 auto",
});

const ErrorAlert = Alert.withProps({
  color: "red",
  variant: "light",
});

const NoModeNote = Text.withProps({
  size: "sm",
  c: "var(--inspector-text-secondary)",
});

const MODE_LABELS: Record<EventSubscriptionMode, string> = {
  poll: "Poll",
  push: "Push",
};

/**
 * The selected event type and the form that subscribes to it (SEP-3415,
 * #3030): its description and delivery modes, its `inputSchema` and
 * `payloadSchema`, the `Mcp-Param-*` headers its arguments mirror into, an
 * argument form generated from `inputSchema`, a mode picker limited to the
 * modes it advertises, and the replay and pacing options each mode accepts.
 */
export function EventDetailPanel({
  eventType,
  formValues,
  onFormChange,
  mode,
  onModeChange,
  tuning,
  onTuningChange,
  onSubscribe,
  subscribeError,
  resetKey,
}: EventDetailPanelProps) {
  const { name, description, delivery, inputSchema, payloadSchema } = eventType;
  const formSchema = toFormSchema(inputSchema) ?? {};
  const modes = subscribableModes(eventType);
  const mirrored = mirroredEventHeaders(eventType);
  // A field holding text it could not turn into a value (#2020).
  const [hasInvalidDraft, setHasInvalidDraft] = useState(false);

  const subscribeDisabled =
    mode === undefined ||
    hasMissingRequiredFields(formSchema, formValues) ||
    hasInvalidDraft;

  return (
    <PanelStack>
      <PinnedHeader>
        <EventTitle>{name}</EventTitle>
        <ModeRow>
          {delivery.map((m) => (
            <DeliveryModeBadge key={m} mode={m} />
          ))}
        </ModeRow>
      </PinnedHeader>

      <BodyScroll>
        <BodyStack>
          {description && <DescriptionText>{description}</DescriptionText>}

          {/* Inline: `Accordion` is a compound, `multiple`-discriminated
              generic whose `.withProps` loses its JSX signature (AGENTS.md). */}
          <Accordion multiple variant="contained">
            <Accordion.Item value="input">
              <Accordion.Control>Input schema</Accordion.Control>
              <Accordion.Panel>
                <SchemaBlock>{formatPayload(inputSchema)}</SchemaBlock>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="payload">
              <Accordion.Control>Payload schema</Accordion.Control>
              <Accordion.Panel>
                {payloadSchema ? (
                  <SchemaBlock>{formatPayload(payloadSchema)}</SchemaBlock>
                ) : (
                  <SectionNote>
                    No payload schema: occurrences are not validated.
                  </SectionNote>
                )}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

          <HeaderSection>
            <SectionTitle>Request headers</SectionTitle>
            <HeaderRow>
              <Code>Mcp-Name</Code>
              <HeaderArrow>=</HeaderArrow>
              <Code>{name}</Code>
            </HeaderRow>
            {mirrored.map((param) => (
              <HeaderRow key={param.path}>
                <Code>{param.path}</Code>
                <HeaderArrow>→</HeaderArrow>
                <Code>{param.header}</Code>
              </HeaderRow>
            ))}
            <SectionNote>
              Sent on every poll and stream request for this event type, so a
              Streamable HTTP server can route it without reading the body.
            </SectionNote>
          </HeaderSection>

          <Divider />

          <SchemaForm
            schema={formSchema}
            values={formValues}
            onChange={onFormChange}
            resetKey={resetKey ?? name}
            onValidityChange={setHasInvalidDraft}
          />

          {mode !== undefined ? (
            <>
              <SegmentedControl
                aria-label="Delivery mode"
                value={mode}
                onChange={(value) => {
                  const picked = modes.find((m) => m === value);
                  /* v8 ignore next -- the control only offers `modes` */
                  if (picked) onModeChange(picked);
                }}
                data={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
              />
              <TuningRow>
                <TuningInput
                  label="maxAgeMs"
                  description="Replay no further back than this"
                  value={tuning.maxAgeMs ?? ""}
                  onChange={(value) =>
                    onTuningChange({
                      ...tuning,
                      maxAgeMs: optionalWholeNumber(value),
                    })
                  }
                />
                {mode === "poll" ? (
                  <TuningInput
                    label="maxEvents"
                    description="Most events per poll"
                    value={tuning.maxEvents ?? ""}
                    onChange={(value) =>
                      onTuningChange({
                        ...tuning,
                        maxEvents: optionalWholeNumber(value),
                      })
                    }
                  />
                ) : (
                  <TuningInput
                    label="heartbeatMs"
                    description="Suggested; the server's grant wins"
                    value={tuning.heartbeatMs ?? ""}
                    onChange={(value) =>
                      onTuningChange({
                        ...tuning,
                        heartbeatMs: optionalWholeNumber(value),
                      })
                    }
                  />
                )}
              </TuningRow>
            </>
          ) : (
            <NoModeNote>
              This event type offers no delivery mode the Inspector can
              subscribe with here ({delivery.join(", ")}).
            </NoModeNote>
          )}
        </BodyStack>
      </BodyScroll>

      {subscribeError && (
        <ErrorAlert title="Subscribe failed">{subscribeError}</ErrorAlert>
      )}

      <FooterRow>
        <Button size="md" onClick={onSubscribe} disabled={subscribeDisabled}>
          Subscribe
        </Button>
      </FooterRow>
    </PanelStack>
  );
}
