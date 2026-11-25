import { useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  Checkbox,
  Code,
  Divider,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { EventSubscriptionMode } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { DeliveryModeBadge } from "../../elements/DeliveryModeBadge/DeliveryModeBadge";
import { WebhookSecretField } from "../../elements/WebhookSecretField/WebhookSecretField";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import {
  hasMissingRequiredFields,
  toFormSchema,
} from "../../../utils/jsonUtils";
import {
  callbackUrlError,
  formatPayload,
  isTuningValid,
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
  /**
   * Set when the form's name, arguments and mode address a subscription that
   * is already running: the button then stops it instead of subscribing
   * again, which the engine would treat as a no-op (#3042).
   */
  onUnsubscribe?: () => void;
  /** Why the last subscribe was refused, shown above the button. */
  subscribeError?: string;
  /** Per-selection identity for the schema form; see `SchemaFormProps`. */
  resetKey?: string;
  /**
   * The signing secret a webhook subscribe will send, generated before the
   * subscribe so it can be copied into the receiver first (the endpoint
   * verification runs during the subscribe). Without one the engine generates
   * it, and it is copyable from the subscription card instead.
   */
  webhookSecret?: string;
  onRegenerateWebhookSecret?: () => void;
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
  variant: "wrapping",
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

// A batch cap or a heartbeat interval of zero means nothing a server can
// honor (the test fixture answers InvalidParams), so these start at 1.
const PositiveTuningInput = NumberInput.withProps({
  min: 1,
  allowDecimal: false,
  allowNegative: false,
  size: "sm",
});

const UnsubscribeButton = Button.withProps({
  size: "md",
  variant: "outline",
  color: "red",
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

const WebhookStack = Stack.withProps({
  gap: "sm",
});

const CallbackInput = TextInput.withProps({
  label: "Callback URL",
  placeholder: "https://",
  size: "sm",
});

const SecretLabel = Text.withProps({
  size: "sm",
  fw: 500,
});

const WebhookNote = Alert.withProps({
  color: "blue",
  variant: "light",
});

const MODE_LABELS: Record<EventSubscriptionMode, string> = {
  poll: "Poll",
  push: "Push",
  webhook: "Webhook",
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
  onUnsubscribe,
  subscribeError,
  resetKey,
  webhookSecret,
  onRegenerateWebhookSecret,
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
    hasInvalidDraft ||
    !isTuningValid(mode, tuning);

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
              Sent on every poll, stream, subscribe and unsubscribe request for
              this event type, so a Streamable HTTP server can route it without
              reading the body.
            </SectionNote>
          </HeaderSection>

          <Divider />

          <SchemaForm
            schema={formSchema}
            values={formValues}
            onChange={onFormChange}
            resetKey={resetKey ?? name}
            onValidityChange={setHasInvalidDraft}
            // The arguments go through the `tools/call` conversion
            // (`eventArguments`), so a raw-JSON draft the conversion would
            // retype is refused rather than sent as something other than
            // what the editor shows (#2171).
            enforceToolArgumentTypes
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
                {mode === "webhook" ? (
                  <TuningInput
                    label="ttlMs"
                    description="Suggested lifetime; the server's grant wins"
                    disabled={tuning.noExpiry === true}
                    value={tuning.ttlMs ?? ""}
                    onChange={(value) =>
                      onTuningChange({
                        ...tuning,
                        ttlMs: optionalWholeNumber(value),
                      })
                    }
                  />
                ) : mode === "poll" ? (
                  <PositiveTuningInput
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
                  <PositiveTuningInput
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
              {mode === "webhook" && (
                <WebhookStack>
                  <Checkbox
                    label="No expiry (ttlMs: null)"
                    description="The server keeps it until you unsubscribe, even after you disconnect"
                    checked={tuning.noExpiry === true}
                    onChange={(event) =>
                      onTuningChange({
                        ...tuning,
                        noExpiry: event.currentTarget.checked,
                      })
                    }
                  />
                  <CallbackInput
                    description="Where the server POSTs deliveries: a receiver you run, such as a tunnel or a request bin"
                    value={tuning.callbackUrl ?? ""}
                    error={callbackUrlError(tuning.callbackUrl)}
                    onChange={(event) =>
                      onTuningChange({
                        ...tuning,
                        callbackUrl: event.currentTarget.value,
                      })
                    }
                  />
                  {webhookSecret !== undefined && (
                    <Stack gap={4}>
                      <SecretLabel>Signing secret</SecretLabel>
                      <WebhookSecretField
                        secret={webhookSecret}
                        onRegenerate={onRegenerateWebhookSecret}
                      />
                      <SectionNote>
                        Generated from a CSPRNG. Copy it into your receiver
                        before subscribing: the server verifies the endpoint
                        with it during the subscribe.
                      </SectionNote>
                    </Stack>
                  )}
                  <WebhookNote>
                    The Inspector manages this subscription (subscribe, refresh
                    before expiry, delivery status, unsubscribe) but does not
                    receive its deliveries. The server must verify the callback
                    endpoint, and requires an authenticated connection for
                    webhook delivery.
                  </WebhookNote>
                </WebhookStack>
              )}
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
        {onUnsubscribe ? (
          <UnsubscribeButton onClick={onUnsubscribe}>
            Unsubscribe
          </UnsubscribeButton>
        ) : (
          <Button size="md" onClick={onSubscribe} disabled={subscribeDisabled}>
            Subscribe
          </Button>
        )}
      </FooterRow>
    </PanelStack>
  );
}
