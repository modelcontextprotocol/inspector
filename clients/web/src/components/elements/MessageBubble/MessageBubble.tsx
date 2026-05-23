import { Group, Paper, Stack, Text } from "@mantine/core";
import type {
  ContentBlock,
  PromptMessage,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../ContentViewer/ContentViewer";

export interface MessageBubbleProps {
  index: number;
  message: SamplingMessage | PromptMessage;
}

function formatRoleLabel(index: number, role: string): string {
  return `[${index}] role: ${role}`;
}

// PromptMessage/SamplingMessage content unions in the SDK are wider than
// ContentBlock (they admit tool_use, tool_result, etc. for the agent
// messages flowing into prompts). ContentViewer renders only the visual
// subset; everything else is silently dropped here. The bubble's role
// header keeps an empty message from being invisible.
const RENDERABLE_TYPES = new Set([
  "text",
  "image",
  "audio",
  "resource",
  "resource_link",
]);

function isRenderableBlock(block: unknown): block is ContentBlock {
  if (typeof block !== "object" || block === null) return false;
  const t = (block as { type?: string }).type;
  return typeof t === "string" && RENDERABLE_TYPES.has(t);
}

// Prompt content blocks don't carry a mimeType on the text variant
// (SDK `TextContent` is just `{ type: "text", text }`). Render text as
// markdown by default so prompt prose with code fences, lists, and links
// looks like prose rather than a preformatted dump. Image / audio blocks
// already carry mimeType; ContentViewer routes them itself.
//
// Caveat: this is unconditional — a server that emits a raw shell
// snippet, log line, or string containing `#` / `_` / backticks will
// have it transformed. Most prompts are prose so the trade-off is
// worth it, but this differs from the resource side (where
// ResourcePreviewPanel only promotes to markdown when the server
// supplies `text/markdown` or the URI suffix matches). If the MCP
// spec ever adds a per-block mimeType for prompt messages, switch
// back to opt-in rendering here.
function effectiveMimeForBlock(block: ContentBlock): string | undefined {
  if (block.type === "text") return "text/markdown";
  return undefined;
}

const BubbleContainer = Paper.withProps({
  p: "md",
  radius: "md",
  withBorder: true,
});

const RoleLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
  ff: "monospace",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
});

export function MessageBubble({ index, message }: MessageBubbleProps) {
  const content = message.content;
  const rawBlocks = Array.isArray(content) ? content : [content];
  const blocks = rawBlocks.filter(isRenderableBlock);

  return (
    <BubbleContainer>
      <Stack gap="xs">
        <HeaderRow>
          <RoleLabel>{formatRoleLabel(index, message.role)}</RoleLabel>
        </HeaderRow>
        {blocks.map((block, blockIndex) => (
          <ContentViewer
            key={blockIndex}
            block={block}
            mimeType={effectiveMimeForBlock(block)}
            copyable
          />
        ))}
      </Stack>
    </BubbleContainer>
  );
}
