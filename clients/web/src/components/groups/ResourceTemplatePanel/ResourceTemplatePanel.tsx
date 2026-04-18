import { useState, useMemo } from "react";
import { Button, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { CopyButton } from "../../elements/CopyButton/CopyButton";

export interface ResourceTemplatePanelProps {
  template: ResourceTemplate;
  onReadResource: (uri: string) => void;
}

function parseVariableNames(uriTemplate: string): string[] {
  const names: string[] = [];
  const regex = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(uriTemplate)) !== null) {
    names.push(match[1]);
  }

  return names;
}

function resolveUri(
  uriTemplate: string,
  variables: Record<string, string>,
): string {
  return uriTemplate.replace(/\{(\w+)\}/g, (_, key: string) => variables[key]);
}

function previewUri(
  uriTemplate: string,
  variables: Record<string, string>,
): string {
  return uriTemplate.replace(/\{(\w+)\}/g, (match, key: string) =>
    variables[key]?.length > 0 ? variables[key] : match,
  );
}

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const UriGroup = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const UriText = Text.withProps({
  size: "sm",
  c: "blue",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const FooterRow = Group.withProps({
  justify: "space-between",
});

const AnnotationGroup = Group.withProps({
  gap: "xs",
});

export function ResourceTemplatePanel({
  template,
  onReadResource,
}: ResourceTemplatePanelProps) {
  const { name, title, uriTemplate, description, annotations } = template;

  const variableNames = useMemo(
    () => parseVariableNames(uriTemplate),
    [uriTemplate],
  );

  const [variables, setVariables] = useState<Record<string, string>>(() =>
    Object.fromEntries(variableNames.map((n) => [n, ""])),
  );

  function handleVariableChange(varName: string, value: string) {
    setVariables((prev) => ({ ...prev, [varName]: value }));
  }

  const canSubmit = variableNames.every((n) => variables[n]?.length > 0);

  function handleSubmit() {
    onReadResource(resolveUri(uriTemplate, variables));
  }

  return (
    <Stack gap="md">
      <HeaderRow>
        <Title order={4}>{title ?? name} Template</Title>
        <UriGroup>
          <UriText>{previewUri(uriTemplate, variables)}</UriText>
          <CopyButton value={previewUri(uriTemplate, variables)} />
        </UriGroup>
      </HeaderRow>
      {description && <DescriptionText>{description}</DescriptionText>}
      <Stack gap="sm">
        {variableNames.map((varName) => (
          <TextInput
            key={varName}
            label={varName}
            placeholder={`Enter ${varName}`}
            value={variables[varName] ?? ""}
            onChange={(e) =>
              handleVariableChange(varName, e.currentTarget.value)
            }
          />
        ))}
      </Stack>
      <FooterRow>
        <AnnotationGroup>
          {annotations?.audience && (
            <AnnotationBadge facet="audience" value={annotations.audience} />
          )}
          {annotations?.priority !== undefined && (
            <AnnotationBadge facet="priority" value={annotations.priority} />
          )}
        </AnnotationGroup>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          Read Resource
        </Button>
      </FooterRow>
    </Stack>
  );
}
