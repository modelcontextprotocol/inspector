import { Button, Group, Text, TextInput } from "@mantine/core";

export interface ResourceTemplateInputProps {
  template: string;
  variables: Record<string, string>;
  onVariableChange: (name: string, value: string) => void;
  onSubmit: () => void;
}

interface TemplatePart {
  type: "static" | "variable";
  value: string;
}

function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const regex = /\{(\w+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "static",
        value: template.slice(lastIndex, match.index),
      });
    }
    parts.push({ type: "variable", value: match[1] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < template.length) {
    parts.push({ type: "static", value: template.slice(lastIndex) });
  }

  return parts;
}

const StaticPart = Text.withProps({
  size: "sm",
  pb: 6,
});

export function ResourceTemplateInput({
  template,
  variables,
  onVariableChange,
  onSubmit,
}: ResourceTemplateInputProps) {
  const parts = parseTemplate(template);

  return (
    <Group gap="xs" align="flex-end">
      {parts.map((part, index) =>
        part.type === "static" ? (
          <StaticPart key={index}>{part.value}</StaticPart>
        ) : (
          <TextInput
            key={part.value}
            size="sm"
            placeholder={part.value}
            value={variables[part.value] ?? ""}
            onChange={(e) =>
              onVariableChange(part.value, e.currentTarget.value)
            }
          />
        ),
      )}
      <Button size="sm" onClick={onSubmit}>
        Go
      </Button>
    </Group>
  );
}
