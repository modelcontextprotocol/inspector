import {
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { MessageBubble } from "../../elements/MessageBubble/MessageBubble";

export interface SamplingRequestPanelProps {
  request: CreateMessageRequestParams;
  draftResult: CreateMessageResult;
  onResultChange: (result: CreateMessageResult) => void;
  onSend: () => void;
  onReject: () => void;
  /**
   * A response has been dispatched; lock the actions so a second click can't
   * resolve the request twice (the underlying handler throws if called again).
   */
  busy?: boolean;
}

function formatPriority(value: number): string {
  if (value < 0.4) return `low (${value})`;
  if (value <= 0.7) return `medium (${value})`;
  return `high (${value})`;
}

function formatOptional(value: unknown, fallback: string): string {
  return value !== undefined ? String(value) : fallback;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

// Section headings. `order: 3` (not 5) keeps them one level below the host
// modal's `h2` title so the outline doesn't skip a level (axe `heading-order`);
// `size: "h5"` preserves the original small visual size.
const SectionTitle = Title.withProps({ order: 3, size: "h5" });

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

// Only the request/response content scrolls; the Reject / Send Response actions
// stay pinned below (in normal flow), always in view — the modal has no other
// close affordance, so the actions must never scroll out of reach. Capping the
// content at the modal's max height (≈90dvh) minus the ~10rem of non-content
// chrome (modal header/padding + the pinned actions + gaps) keeps the whole
// modal within the viewport; `ScrollArea.Autosize` sizes to content when the
// request is short (nothing scrolls) and scrolls once it hits the cap. (Mirrors
// ElicitationFormPanel.)
const ContentScroll = ScrollArea.Autosize.withProps({
  mah: "calc(90dvh - 10rem)",
  scrollbars: "y",
  offsetScrollbars: true,
});

// Inner column for the scrolled content, so `ContentScroll` wraps a single
// child and the sections keep their `md` spacing.
const ContentStack = Stack.withProps({ gap: "md" });

const PreferencesContainer = Paper.withProps({
  p: "sm",
  withBorder: true,
});

const RejectButton = Button.withProps({
  variant: "light",
  color: "red",
});

export function SamplingRequestPanel({
  request,
  draftResult,
  onResultChange,
  onSend,
  onReject,
  busy = false,
}: SamplingRequestPanelProps) {
  const {
    messages,
    modelPreferences,
    maxTokens,
    stopSequences,
    temperature,
    includeContext,
  } = request;

  const hints =
    (modelPreferences?.hints?.map((h) => h.name).filter(Boolean) as string[]) ??
    [];

  return (
    <Stack gap="md">
      <ContentScroll>
        <ContentStack>
          <HintText>The server is requesting an LLM completion.</HintText>

          <SectionTitle>Messages:</SectionTitle>
          {messages.map((message, index) => (
            <MessageBubble key={index} index={index} message={message} />
          ))}

          {modelPreferences && (
            <PreferencesContainer>
              <Stack gap="xs">
                <SectionTitle>Model Preferences:</SectionTitle>
                {hints.length > 0 && (
                  <Group gap="xs">
                    <Text size="sm">Hints:</Text>
                    {hints.map((hint) => (
                      <Badge key={hint}>{hint}</Badge>
                    ))}
                  </Group>
                )}
                {modelPreferences?.costPriority !== undefined && (
                  <Text size="sm">
                    Cost Priority:{" "}
                    {formatPriority(modelPreferences.costPriority)}
                  </Text>
                )}
                {modelPreferences?.speedPriority !== undefined && (
                  <Text size="sm">
                    Speed Priority:{" "}
                    {formatPriority(modelPreferences.speedPriority)}
                  </Text>
                )}
                {modelPreferences?.intelligencePriority !== undefined && (
                  <Text size="sm">
                    Intelligence Priority:{" "}
                    {formatPriority(modelPreferences.intelligencePriority)}
                  </Text>
                )}
              </Stack>
            </PreferencesContainer>
          )}

          <SectionTitle>Parameters:</SectionTitle>
          <Text size="sm">
            Max Tokens: {formatOptional(maxTokens, "not specified")}
          </Text>
          <Text size="sm">
            Stop Sequences:{" "}
            {stopSequences ? serializeJson(stopSequences) : "not specified"}
          </Text>
          <Text size="sm">
            Temperature: {formatOptional(temperature, "not specified")}
          </Text>

          {includeContext && (
            <Group gap="xs">
              <Text size="sm">Include Context:</Text>
              <Badge>{includeContext}</Badge>
            </Group>
          )}

          <Divider />

          <SectionTitle>Response:</SectionTitle>
          <Textarea
            aria-label="Response"
            value={
              draftResult.content.type === "text"
                ? draftResult.content.text
                : ""
            }
            onChange={(event) =>
              onResultChange({
                ...draftResult,
                content: { type: "text", text: event.currentTarget.value },
              })
            }
            autosize
            minRows={3}
            rightSectionPointerEvents="auto"
            rightSection={
              draftResult.content.type === "text" &&
              draftResult.content.text ? (
                <ClearButton
                  onClick={() =>
                    onResultChange({
                      ...draftResult,
                      content: { type: "text", text: "" },
                    })
                  }
                />
              ) : null
            }
          />
          <Group>
            <TextInput
              label="Model Used"
              value={draftResult.model}
              onChange={(event) =>
                onResultChange({
                  ...draftResult,
                  model: event.currentTarget.value,
                })
              }
              rightSectionPointerEvents="auto"
              rightSection={
                draftResult.model ? (
                  <ClearButton
                    onClick={() =>
                      onResultChange({ ...draftResult, model: "" })
                    }
                  />
                ) : null
              }
            />
            <Select
              label="Stop Reason"
              data={["endTurn", "stopSequence", "maxTokens"]}
              value={draftResult.stopReason ?? null}
              onChange={(value) =>
                onResultChange({
                  ...draftResult,
                  stopReason: value ?? undefined,
                })
              }
            />
          </Group>
        </ContentStack>
      </ContentScroll>
      <Group justify="flex-end">
        <RejectButton onClick={onReject} disabled={busy}>
          Reject
        </RejectButton>
        <Button onClick={onSend} disabled={busy}>
          Send Response
        </Button>
      </Group>
    </Stack>
  );
}
