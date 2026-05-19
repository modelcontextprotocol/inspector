import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { CopyButton } from "../../elements/CopyButton/CopyButton";

export interface ResourceTemplatePanelProps {
  template: ResourceTemplate;
  onReadResource: (uri: string) => void;
  /**
   * When provided, each keystroke in a variable input dispatches a
   * (debounced) `completion/complete` request to the server. The
   * resolved values are surfaced as a dropdown via Mantine `Autocomplete`.
   * Wire to `InspectorClient.getCompletions` in the host App.
   */
  onCompleteArgument?: (
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
  /**
   * Gates whether to render Autocomplete (with live completions) vs the
   * plain TextInput. Typically derived from the server's
   * `completions` capability.
   */
  completionsSupported?: boolean;
}

const COMPLETION_DEBOUNCE_MS = 300;

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
  onCompleteArgument,
  completionsSupported = false,
}: ResourceTemplatePanelProps) {
  const { name, title, uriTemplate, description, annotations } = template;

  const variableNames = useMemo(
    () => parseVariableNames(uriTemplate),
    [uriTemplate],
  );

  const [variables, setVariables] = useState<Record<string, string>>(() =>
    Object.fromEntries(variableNames.map((n) => [n, ""])),
  );
  const [completions, setCompletions] = useState<Record<string, string[]>>({});

  // Reset state when the user switches to a different template.
  useEffect(() => {
    setVariables(Object.fromEntries(variableNames.map((n) => [n, ""])));
    setCompletions({});
  }, [uriTemplate, variableNames]);

  // Latest in-flight controller per argument, so a faster keystroke can
  // abort an outstanding completion request and the late response can't
  // overwrite the fresh one.
  const requestsRef = useRef<Map<string, AbortController>>(new Map());
  // Debounce timer per argument so we don't spam the server on every key.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Drop pending timers / abort in-flight requests on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    const requests = requestsRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const c of requests.values()) c.abort();
      requests.clear();
    };
  }, []);

  const useAutocomplete = completionsSupported && !!onCompleteArgument;

  const runCompletion = useCallback(
    async (varName: string, value: string, context: Record<string, string>) => {
      if (!onCompleteArgument) return;
      requestsRef.current.get(varName)?.abort();
      const controller = new AbortController();
      requestsRef.current.set(varName, controller);
      try {
        const values = await onCompleteArgument(varName, value, context);
        if (controller.signal.aborted) return;
        setCompletions((prev) => ({ ...prev, [varName]: values }));
      } catch {
        if (!controller.signal.aborted) {
          setCompletions((prev) => ({ ...prev, [varName]: [] }));
        }
      } finally {
        if (requestsRef.current.get(varName) === controller) {
          requestsRef.current.delete(varName);
        }
      }
    },
    [onCompleteArgument],
  );

  function handleVariableChange(varName: string, value: string) {
    setVariables((prev) => {
      const next = { ...prev, [varName]: value };
      if (useAutocomplete) {
        // Schedule a debounced completion call. The `context` carries the
        // other variables' current values so the server can disambiguate
        // when one variable depends on another.
        const context: Record<string, string> = { ...next };
        delete context[varName];
        const existing = timersRef.current.get(varName);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          timersRef.current.delete(varName);
          void runCompletion(varName, value, context);
        }, COMPLETION_DEBOUNCE_MS);
        timersRef.current.set(varName, timer);
      }
      return next;
    });
  }

  const canSubmit = variableNames.every((n) => variables[n]?.length > 0);

  function handleSubmit() {
    onReadResource(resolveUri(uriTemplate, variables));
  }

  const preview = previewUri(uriTemplate, variables);

  return (
    <Stack gap="md">
      <HeaderRow>
        <Title order={4}>{title ?? name} Template</Title>
        <UriGroup>
          <UriText>{preview}</UriText>
          <CopyButton value={preview} />
        </UriGroup>
      </HeaderRow>
      {description && <DescriptionText>{description}</DescriptionText>}
      <Stack gap="sm">
        {variableNames.map((varName) =>
          useAutocomplete ? (
            <Autocomplete
              key={varName}
              label={varName}
              placeholder={`Enter ${varName}`}
              value={variables[varName] ?? ""}
              data={completions[varName] ?? []}
              // The server already filtered the values for the typed
              // prefix; passing options through verbatim avoids hiding
              // valid suggestions when the input is empty or doesn't
              // substring-match what the server returned.
              filter={({ options }) => options}
              onChange={(value) => handleVariableChange(varName, value)}
            />
          ) : (
            <TextInput
              key={varName}
              label={varName}
              placeholder={`Enter ${varName}`}
              value={variables[varName] ?? ""}
              onChange={(e) =>
                handleVariableChange(varName, e.currentTarget.value)
              }
            />
          ),
        )}
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
