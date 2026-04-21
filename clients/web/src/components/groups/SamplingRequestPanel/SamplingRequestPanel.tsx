import {
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { MessageBubble } from "../../elements/MessageBubble/MessageBubble";

export interface SamplingRequestPanelProps {
  request: CreateMessageRequestParams;
  draftResult: CreateMessageResult;
  onResultChange: (result: CreateMessageResult) => void;
  onAutoRespond: () => void;
  onSend: () => void;
  onReject: () => void;
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

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

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
  onAutoRespond,
  onSend,
  onReject,
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
      <HintText>The server is requesting an LLM completion.</HintText>

      <Title order={5}>Messages:</Title>
      {messages.map((message, index) => (
        <MessageBubble key={index} index={index} message={message} />
      ))}

      {modelPreferences && (
        <PreferencesContainer>
          <Stack gap="xs">
            <Title order={5}>Model Preferences:</Title>
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
                Cost Priority: {formatPriority(modelPreferences.costPriority)}
              </Text>
            )}
            {modelPreferences?.speedPriority !== undefined && (
              <Text size="sm">
                Speed Priority: {formatPriority(modelPreferences.speedPriority)}
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

      <Title order={5}>Parameters:</Title>
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

      <Title order={5}>Response:</Title>
      <Textarea
        value={
          draftResult.content.type === "text" ? draftResult.content.text : ""
        }
        onChange={(event) =>
          onResultChange({
            ...draftResult,
            content: { type: "text", text: event.currentTarget.value },
          })
        }
        autosize
        minRows={3}
      />
      <Group>
        <TextInput
          label="Model Used"
          value={draftResult.model}
          onChange={(event) =>
            onResultChange({ ...draftResult, model: event.currentTarget.value })
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
      <Group justify="flex-end">
        <Button variant="light" onClick={onAutoRespond}>
          Auto-respond
        </Button>
        <RejectButton onClick={onReject}>Reject</RejectButton>
        <Button onClick={onSend}>Send Response</Button>
      </Group>
    </Stack>
  );
}
