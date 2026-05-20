import { useCallback, useEffect, useRef, useState } from "react";
import {
  Autocomplete,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

export interface PromptArgumentsFormProps {
  prompt: Prompt;
  argumentValues: Record<string, string>;
  onArgumentChange: (name: string, value: string) => void;
  onGetPrompt: () => void;
  /**
   * When provided, each keystroke in an argument input dispatches a
   * (debounced) `completion/complete` request to the server and surfaces
   * the returned values as a dropdown via Mantine `Autocomplete`.
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

const PromptTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function formatPlaceholder(name: string): string {
  return `Enter ${name}...`;
}

export function PromptArgumentsForm({
  prompt,
  argumentValues,
  onArgumentChange,
  onGetPrompt,
  onCompleteArgument,
  completionsSupported = false,
}: PromptArgumentsFormProps) {
  const { name, title, description, arguments: promptArguments } = prompt;

  const [completions, setCompletions] = useState<Record<string, string[]>>({});

  // Reset completion state whenever the active prompt changes — completions
  // are keyed by argument name, and the same name could mean different
  // things across prompts.
  useEffect(() => {
    setCompletions({});
  }, [name]);

  // Per-arg in-flight controller (later keystroke aborts older request).
  const requestsRef = useRef<Map<string, AbortController>>(new Map());
  // Per-arg debounce timer so we don't spam the server on every key.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

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
    async (argName: string, value: string, context: Record<string, string>) => {
      if (!onCompleteArgument) return;
      requestsRef.current.get(argName)?.abort();
      const controller = new AbortController();
      requestsRef.current.set(argName, controller);
      try {
        const values = await onCompleteArgument(argName, value, context);
        if (controller.signal.aborted) return;
        setCompletions((prev) => ({ ...prev, [argName]: values }));
      } catch {
        if (!controller.signal.aborted) {
          setCompletions((prev) => ({ ...prev, [argName]: [] }));
        }
      } finally {
        if (requestsRef.current.get(argName) === controller) {
          requestsRef.current.delete(argName);
        }
      }
    },
    [onCompleteArgument],
  );

  function handleChange(argName: string, value: string) {
    onArgumentChange(argName, value);
    if (!useAutocomplete) return;
    // The completing arg is excluded from context so the server can
    // disambiguate when one argument depends on another.
    const context: Record<string, string> = {
      ...argumentValues,
      [argName]: value,
    };
    delete context[argName];
    const existing = timersRef.current.get(argName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timersRef.current.delete(argName);
      void runCompletion(argName, value, context);
    }, COMPLETION_DEBOUNCE_MS);
    timersRef.current.set(argName, timer);
  }

  return (
    <Stack gap="md">
      <PromptTitle>{title ?? name}</PromptTitle>
      {description && <DescriptionText>{description}</DescriptionText>}
      {promptArguments && promptArguments.length > 0 && (
        <>
          <Title order={4}>Arguments</Title>
          <Stack gap="sm">
            {promptArguments.map((arg) =>
              useAutocomplete ? (
                <Autocomplete
                  key={arg.name}
                  label={arg.name}
                  withAsterisk={arg.required === true}
                  description={arg.description}
                  placeholder={formatPlaceholder(arg.name)}
                  value={argumentValues[arg.name] || ""}
                  data={completions[arg.name] ?? []}
                  // The server already filtered for the typed prefix.
                  // Passing options through verbatim avoids hiding valid
                  // suggestions client-side.
                  filter={({ options }) => options}
                  onChange={(value) => handleChange(arg.name, value)}
                />
              ) : (
                <TextInput
                  key={arg.name}
                  label={arg.name}
                  withAsterisk={arg.required === true}
                  description={arg.description}
                  placeholder={formatPlaceholder(arg.name)}
                  value={argumentValues[arg.name] || ""}
                  onChange={(event) =>
                    handleChange(arg.name, event.currentTarget.value)
                  }
                />
              ),
            )}
          </Stack>
        </>
      )}
      <Group justify="flex-end">
        <Button size="sm" onClick={onGetPrompt}>
          Get Prompt
        </Button>
      </Group>
    </Stack>
  );
}
