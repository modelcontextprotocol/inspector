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
import { MessageBubble } from "../../atoms/MessageBubble/MessageBubble";

export interface SamplingMessage {
  role: string;
  content: string;
  imageContent?: { data: string; mimeType: string };
}

export interface SamplingTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface SamplingRequestPanelProps {
  messages: SamplingMessage[];
  modelHints?: string[];
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
  maxTokens?: number;
  stopSequences?: string[];
  temperature?: number;
  includeContext?: string;
  tools?: SamplingTool[];
  toolChoice?: string;
  responseText: string;
  modelUsed: string;
  stopReason: string;
  onResponseChange: (text: string) => void;
  onModelChange: (model: string) => void;
  onStopReasonChange: (reason: string) => void;
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

const ToolCard = Paper.withProps({
  p: "xs",
  withBorder: true,
});

const ToolName = Text.withProps({
  size: "sm",
  fw: 600,
});

const RejectButton = Button.withProps({
  variant: "light",
  color: "red",
});

export function SamplingRequestPanel({
  messages,
  modelHints,
  costPriority,
  speedPriority,
  intelligencePriority,
  maxTokens,
  stopSequences,
  temperature,
  includeContext,
  tools,
  toolChoice,
  responseText,
  modelUsed,
  stopReason,
  onResponseChange,
  onModelChange,
  onStopReasonChange,
  onAutoRespond,
  onSend,
  onReject,
}: SamplingRequestPanelProps) {
  return (
    <Stack gap="md">
      <HintText>The server is requesting an LLM completion.</HintText>

      <Title order={5}>Messages:</Title>
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          index={index}
          role={message.role as "user" | "assistant"}
          content={message.content}
          imageContent={message.imageContent}
        />
      ))}

      {modelHints && modelHints.length > 0 && (
        <PreferencesContainer>
          <Stack gap="xs">
            <Title order={5}>Model Preferences:</Title>
            <Group gap="xs">
              <Text size="sm">Hints:</Text>
              {modelHints.map((hint) => (
                <Badge key={hint}>{hint}</Badge>
              ))}
            </Group>
            {costPriority !== undefined && (
              <Text size="sm">
                Cost Priority: {formatPriority(costPriority)}
              </Text>
            )}
            {speedPriority !== undefined && (
              <Text size="sm">
                Speed Priority: {formatPriority(speedPriority)}
              </Text>
            )}
            {intelligencePriority !== undefined && (
              <Text size="sm">
                Intelligence Priority: {formatPriority(intelligencePriority)}
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

      {tools && tools.length > 0 && (
        <>
          <Title order={5}>Available Tools:</Title>
          {tools.map((tool) => (
            <ToolCard key={tool.name}>
              <ToolName>{tool.name}</ToolName>
              {tool.description && <Text size="sm">{tool.description}</Text>}
            </ToolCard>
          ))}
        </>
      )}

      {toolChoice && <Text size="sm">Tool Choice: {toolChoice}</Text>}

      <Divider />

      <Title order={5}>Response:</Title>
      <Textarea
        value={responseText}
        onChange={(event) => onResponseChange(event.currentTarget.value)}
        autosize
        minRows={3}
      />
      <Group>
        <TextInput
          label="Model Used"
          value={modelUsed}
          onChange={(event) => onModelChange(event.currentTarget.value)}
        />
        <Select
          label="Stop Reason"
          data={["end_turn", "max_tokens", "stop_sequence", "toolUse"]}
          value={stopReason}
          onChange={(value) => onStopReasonChange(value ?? "")}
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
