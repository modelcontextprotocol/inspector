import { Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { MdContentCopy, MdDownload } from "react-icons/md";
import {
  parseToFSM,
  type FSMTransition,
} from "../../screens/ProtocolBuilderScreen/protocol";

export interface ProtocolOutputPanelProps {
  protocol: string;
  pythonSnippet: string;
  copied: "dsl" | "python" | null;
  onCopyDsl: () => void;
  onCopyPython: () => void;
  onDownload: () => void;
}

const SectionLabel = Text.withProps({
  size: "xs",
  fw: 600,
  tt: "uppercase",
  c: "dimmed",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  align: "center",
});

const CopyButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

const CodeBlock = Paper.withProps({
  variant: "code",
  withBorder: true,
});

const PythonScroll = ScrollArea.Autosize.withProps({
  mah: 240,
});

const StateBadge = Paper.withProps({
  withBorder: true,
  px: 6,
  py: 2,
  radius: "sm",
  bg: "var(--inspector-surface-card)",
});

const TransitionPill = Paper.withProps({
  px: 6,
  py: 2,
  radius: "sm",
});

export function ProtocolOutputPanel({
  protocol,
  pythonSnippet,
  copied,
  onCopyDsl,
  onCopyPython,
  onDownload,
}: ProtocolOutputPanelProps) {
  return (
    <Stack gap="md">
      <Stack gap={4}>
        <HeaderRow>
          <SectionLabel>Session Type DSL</SectionLabel>
          <CopyButton
            onClick={onCopyDsl}
            leftSection={<MdContentCopy size={12} />}
          >
            {copied === "dsl" ? "Copied!" : "Copy"}
          </CopyButton>
        </HeaderRow>
        <CodeBlock>
          <ProtocolHighlight protocol={protocol} />
        </CodeBlock>
      </Stack>

      <Stack gap={4}>
        <SectionLabel>State Machine Preview</SectionLabel>
        <Paper withBorder p="sm">
          <StateMachinePreview protocol={protocol} />
        </Paper>
      </Stack>

      <Stack gap={4}>
        <HeaderRow>
          <SectionLabel>Python Integration</SectionLabel>
          <CopyButton
            onClick={onCopyPython}
            leftSection={<MdContentCopy size={12} />}
          >
            {copied === "python" ? "Copied!" : "Copy"}
          </CopyButton>
        </HeaderRow>
        <PythonScroll>
          <CodeBlock>
            <Text component="pre" ff="monospace" size="xs" m={0}>
              {pythonSnippet}
            </Text>
          </CodeBlock>
        </PythonScroll>
      </Stack>

      <Button
        variant="default"
        size="sm"
        fullWidth
        onClick={onDownload}
        leftSection={<MdDownload size={14} />}
      >
        Download Python File
      </Button>
    </Stack>
  );
}

interface ProtocolHighlightProps {
  protocol: string;
}

function ProtocolHighlight({ protocol }: ProtocolHighlightProps) {
  const tokens: { text: string; color?: string; italic?: boolean }[] = [];
  let i = 0;
  const src = protocol;
  const isWordChar = (c: string): boolean => /[a-zA-Z0-9_-]/.test(c);

  while (i < src.length) {
    const c = src[i];
    if (c === "!") {
      tokens.push({ text: "!", color: "var(--inspector-protocol-send-text)" });
      i += 1;
    } else if (c === "?") {
      tokens.push({
        text: "?",
        color: "var(--inspector-protocol-receive-text)",
      });
      i += 1;
    } else if (c === "." || c === "{" || c === "}" || c === ",") {
      tokens.push({ text: c, color: "var(--inspector-text-secondary)" });
      i += 1;
    } else if (
      src.slice(i, i + 3) === "rec" &&
      (i + 3 >= src.length || !isWordChar(src[i + 3]))
    ) {
      tokens.push({
        text: "rec",
        color: "var(--inspector-protocol-recursion-text)",
        italic: true,
      });
      i += 3;
    } else if (
      src.slice(i, i + 3) === "end" &&
      (i + 3 >= src.length || !isWordChar(src[i + 3]))
    ) {
      tokens.push({
        text: "end",
        color: "var(--inspector-text-secondary)",
        italic: true,
      });
      i += 3;
    } else if (isWordChar(c)) {
      const start = i;
      while (i < src.length && isWordChar(src[i])) i += 1;
      tokens.push({
        text: src.slice(start, i),
        color: "var(--inspector-text-primary)",
      });
    } else {
      tokens.push({ text: c });
      i += 1;
    }
  }

  return (
    <>
      {tokens.map((t, idx) => (
        <Text
          key={idx}
          span
          ff="monospace"
          size="xs"
          c={t.color}
          fs={t.italic ? "italic" : undefined}
        >
          {t.text}
        </Text>
      ))}
    </>
  );
}

interface StateMachinePreviewProps {
  protocol: string;
}

function StateMachinePreview({ protocol }: StateMachinePreviewProps) {
  let result;
  try {
    result = parseToFSM(protocol);
  } catch {
    return (
      <Text size="xs" c="dimmed" fs="italic">
        Could not parse the current protocol
      </Text>
    );
  }
  const { states, transitions, endStates } = result;
  if (transitions.length === 0) {
    return (
      <Text size="xs" c="dimmed" fs="italic">
        Add steps to see the state machine
      </Text>
    );
  }

  const bySource = new Map<number, FSMTransition[]>();
  for (const t of transitions) {
    const arr = bySource.get(t.from) ?? [];
    arr.push(t);
    bySource.set(t.from, arr);
  }
  const allStates = Array.from(states).sort((a, b) => a - b);

  return (
    <Stack gap={6}>
      {allStates.map((s) => {
        const outgoing = bySource.get(s);
        if (!outgoing || outgoing.length === 0) {
          if (endStates.has(s)) {
            return (
              <Group key={s} gap={6}>
                <StateBadge>
                  <Text ff="monospace" size="xs">
                    S{s}
                  </Text>
                </StateBadge>
                <Text size="xs" c="dimmed" fs="italic">
                  end
                </Text>
              </Group>
            );
          }
          return null;
        }
        return (
          <Group key={s} gap={6} align="flex-start">
            <StateBadge>
              <Text ff="monospace" size="xs">
                S{s}
              </Text>
            </StateBadge>
            <Text size="xs" c="dimmed">
              →
            </Text>
            <Stack gap={2}>
              {outgoing.map((t, idx) => (
                <Group key={idx} gap={6}>
                  <TransitionPill bg={transitionBg(t.dir)}>
                    <Text ff="monospace" size="xs" c={transitionColor(t.dir)}>
                      {transitionGlyph(t.dir)}
                      {t.label}
                    </Text>
                  </TransitionPill>
                  <Text size="xs" c="dimmed">
                    →
                  </Text>
                  <StateBadge>
                    <Text ff="monospace" size="xs">
                      S{t.to}
                    </Text>
                  </StateBadge>
                </Group>
              ))}
            </Stack>
          </Group>
        );
      })}
    </Stack>
  );
}

function transitionBg(dir: FSMTransition["dir"]): string {
  if (dir === "send") return "var(--inspector-protocol-send-bg)";
  if (dir === "receive") return "var(--inspector-protocol-receive-bg)";
  return "var(--inspector-protocol-recursion-bg)";
}

function transitionColor(dir: FSMTransition["dir"]): string {
  if (dir === "send") return "var(--inspector-protocol-send-text)";
  if (dir === "receive") return "var(--inspector-protocol-receive-text)";
  return "var(--inspector-protocol-recursion-text)";
}

function transitionGlyph(dir: FSMTransition["dir"]): string {
  if (dir === "send") return "!";
  if (dir === "receive") return "?";
  return "↻";
}
