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
import { accessibleTextColor } from "../../elements/accessibleTextColor";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import { useValueChange } from "../../../hooks/useValueChange";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import {
  definedValues,
  previewUriTemplate,
  requiredGroups,
  templateVariables,
  tryExpandUriTemplate,
  unmetRequiredGroups,
} from "../../../utils/uriTemplate";

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

/**
 * The completions fetched for one variable, ignoring anything inherited from
 * `Object.prototype`.
 *
 * `toString`, `constructor` and `__proto__` are valid RFC 6570 variable names,
 * and this map starts empty — so a bare `completions[varName] ?? []` returned
 * the prototype's *function* for such a name (`??` only catches null and
 * undefined) and handed it to Mantine as its `data` array, crashing the field
 * on first render. Same hazard the expansion path fixed for values; this is
 * the one place the component reads a name-keyed map it did not seed.
 */
function completionsFor(
  completions: Record<string, string[]>,
  varName: string,
): string[] {
  return Object.hasOwn(completions, varName) ? completions[varName] : [];
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
  // Scheme-aware readable blue (`c="blue"` is blue-4 in dark, 4.38:1 on the
  // card — just under WCAG AA); see `accessibleTextColor`.
  c: accessibleTextColor("blue"),
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

// Why Read Resource is disabled when the template itself cannot be expanded.
// Without it the button is inert with nothing on screen explaining the refusal.
//
// `role="alert"` because the message can appear *while typing* -- a pasted
// value that cannot be encoded -- so a screen-reader user would otherwise meet
// a silently disabled action. An alert is an assertive live region, which is
// what announces text that arrives after first render.
// What is still missing before Read Resource can fire. Dimmed rather than red:
// an incomplete form is the expected starting state, not an error.
const RequirementText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ExpansionErrorText = Text.withProps({
  size: "sm",
  c: "red",
  role: "alert",
});

// Left-aligned so the action sits closest to the sidebar controls / the form
// fields above; annotation badges trail it.
const FooterRow = Group.withProps({
  justify: "flex-start",
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

  // Every variable the template declares, with the operator it appears under
  // and whether omitting it would change the URI's shape (see `utils/uriTemplate`).
  const declaredVariables = useMemo(
    () => templateVariables(uriTemplate),
    [uriTemplate],
  );
  const variableNames = useMemo(
    () => declaredVariables.map((v) => v.name),
    [declaredVariables],
  );
  // The names of each expression that cannot be omitted. Kept separate from
  // `declaredVariables` (which is deduplicated for rendering) because each
  // required expression has to be satisfied on its own — see `requiredGroups`.
  const groups = useMemo(() => requiredGroups(uriTemplate), [uriTemplate]);

  const [variables, setVariables] = useState<Record<string, string>>(() =>
    Object.fromEntries(variableNames.map((n) => [n, ""])),
  );
  const [completions, setCompletions] = useState<Record<string, string[]>>({});

  // Reset state when the user switches to a different template. Keyed on
  // `uriTemplate` alone because `variableNames` is memoized from it, so the two
  // can never change independently.
  useValueChange(uriTemplate, () => {
    setVariables(Object.fromEntries(variableNames.map((n) => [n, ""])));
    setCompletions({});
  });

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
      /* v8 ignore next -- unreachable: runCompletion is only invoked when
         useAutocomplete is true, which already requires onCompleteArgument. */
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

  // Hold the latest `variables` in a ref so a debounced completion
  // call reads sibling values at fire time, not at schedule time.
  // Typing in A then B within the 300ms window would otherwise ship
  // A's request with B's value still empty in context.
  const variablesRef = useRef(variables);
  useEffect(() => {
    variablesRef.current = variables;
  }, [variables]);

  function buildContext(varName: string): Record<string, string> {
    const ctx: Record<string, string> = { ...variablesRef.current };
    delete ctx[varName];
    return ctx;
  }

  function handleVariableChange(varName: string, value: string) {
    setVariables((prev) => ({ ...prev, [varName]: value }));
    if (!useAutocomplete) return;
    // Drop the previous prefix's completions so the dropdown doesn't
    // show ghost suggestions from the old keystroke while the new
    // request is in flight (300ms debounce + network latency).
    setCompletions((prev) => {
      // Own-property, as above: an inherited member is not a stale dropdown.
      if (!Object.hasOwn(prev, varName)) return prev;
      const next = { ...prev };
      delete next[varName];
      return next;
    });
    const existing = timersRef.current.get(varName);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timersRef.current.delete(varName);
      // Build context at fire time so sibling updates that arrived
      // between schedule and fire are picked up.
      void runCompletion(varName, value, buildContext(varName));
    }, COMPLETION_DEBOUNCE_MS);
    timersRef.current.set(varName, timer);
  }

  function handleVariableFocus(varName: string) {
    /* v8 ignore next -- unreachable: the plain (non-autocomplete) TextInput
       has no onFocus, so this handler only runs when useAutocomplete is true. */
    if (!useAutocomplete) return;
    // Fire immediately so the dropdown isn't empty when the user first
    // clicks in. Cancel any pending debounce for this variable so a
    // stale keystroke request doesn't overwrite the fresher focus
    // response. `variables` already carries every declared template
    // variable (seeded with "") so the context is complete by default.
    const existing = timersRef.current.get(varName);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(varName);
    }
    /* v8 ignore next -- the `?? ""` fallback is unreachable: `variables` (and
       its ref) is seeded with every declared variable, so the key is present. */
    const value = variablesRef.current[varName] ?? "";
    void runCompletion(varName, value, buildContext(varName));
  }

  // Two independent gates on the read.
  //
  // First, whether the values cover what expansion structurally needs. Only the
  // expressions whose absence would change the URI's shape count; an unfilled
  // `{?topic}` is a legitimate request for the unfiltered resource, and RFC 6570
  // drops the whole expression for it. The rule is per-expression rather than
  // per-variable -- `{a,b}` with only `a` filled expands to `a`'s value -- so it
  // lives in core beside the expander.
  //
  // Second, whether the template expands at all. A template the server
  // advertised can be malformed (`{id:abc}`, `{a,}`) and a pasted value can be
  // unencodable, and in neither case is there a URI to send -- so withhold the
  // request and say why, rather than reading the raw template with its braces
  // intact and letting the server answer with a confusing "not found".
  // `definedValues` is applied here rather than inside the expander: a key
  // present with `""` is a *defined* RFC 6570 value and legitimately expands to
  // `?topic=`, but this form seeds every declared variable with `""`, so an
  // untouched field is indistinguishable from a deliberately empty one. That is
  // a fact about the form, so the form is what resolves it.
  const expansion = tryExpandUriTemplate(uriTemplate, definedValues(variables));
  // Named rather than merely counted, so a disabled Read Resource always has a
  // reason on screen. Per-field hints cannot carry this: a variable shared
  // across several groups looks satisfied once any one of them is met.
  const unmet = unmetRequiredGroups(groups, variables);
  const canSubmit = expansion.error === undefined && unmet.length === 0;

  function handleSubmit() {
    /* v8 ignore next -- unreachable: the button is disabled whenever the
       expansion failed, which is the only way `uri` is undefined. */
    if (expansion.uri === undefined) return;
    onReadResource(expansion.uri);
  }

  const preview = previewUriTemplate(uriTemplate, variables);

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
        {declaredVariables.map(({ name: varName, required }) => {
          /* v8 ignore next -- `?? ""` fallback unreachable: `variables` is seeded with every declared variable, so the key is always present. */
          const fieldValue = variables[varName] ?? "";
          // RFC 6570 omits an undefined variable under a query/path-segment
          // operator entirely, so those fields are genuinely optional. In a
          // required multi-name expression no single field is mandatory either
          // -- any one of them satisfies it -- so say which, rather than
          // marking each one required and blocking valid input.
          // A name can sit in a singleton required group *and* a shared one
          // (`x://{a}/{a,b}`). The singleton demands this exact field, so the
          // "any one of" hint would contradict the disabled submit button --
          // suppress it and let the field read as plainly required.
          const individuallyRequired = groups.some(
            (names) => names.length === 1 && names[0] === varName,
          );
          // EVERY shared group this variable sits in, not the first. With
          // `{a,b}{b,c}{a,c}`, showing only the first left `b` looking like it
          // satisfied everything while Read Resource stayed disabled on the
          // unmet `{a,c}` -- a hidden requirement is worse than a wordy hint.
          // The form-level "Still needed" line below names what is actually
          // outstanding, which is the part a per-field hint cannot express.
          const sharedGroups = individuallyRequired
            ? []
            : groups.filter(
                (names) => names.length > 1 && names.includes(varName),
              );
          const description = !required
            ? "Optional"
            : sharedGroups.length > 0
              ? `Any one of${sharedGroups.length > 1 ? " each" : ""}: ${sharedGroups
                  .map((names) => names.join(", "))
                  .join("; ")}`
              : undefined;
          return useAutocomplete ? (
            <Autocomplete
              key={varName}
              label={varName}
              description={description}
              placeholder={`Enter ${varName}`}
              value={fieldValue}
              data={completionsFor(completions, varName)}
              // The server already filtered the values for the typed
              // prefix; passing options through verbatim avoids hiding
              // valid suggestions when the input is empty or doesn't
              // substring-match what the server returned.
              filter={({ options }) => options}
              onChange={(value) => handleVariableChange(varName, value)}
              onFocus={() => handleVariableFocus(varName)}
            />
          ) : (
            <TextInput
              key={varName}
              label={varName}
              description={description}
              placeholder={`Enter ${varName}`}
              value={fieldValue}
              onChange={(e) =>
                handleVariableChange(varName, e.currentTarget.value)
              }
              rightSectionPointerEvents="auto"
              rightSection={
                variables[varName] ? (
                  <ClearButton
                    onClick={() => handleVariableChange(varName, "")}
                  />
                ) : null
              }
            />
          );
        })}
      </Stack>
      {expansion.error !== undefined && (
        <ExpansionErrorText>{expansion.error}</ExpansionErrorText>
      )}
      {expansion.error === undefined && unmet.length > 0 && (
        <RequirementText>
          Still needed: {unmet.map((names) => names.join(" or ")).join("; ")}
        </RequirementText>
      )}
      <FooterRow>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          Read Resource
        </Button>
        <AnnotationGroup>
          {annotations?.audience && (
            <AnnotationBadge facet="audience" value={annotations.audience} />
          )}
          {annotations?.priority !== undefined && (
            <AnnotationBadge facet="priority" value={annotations.priority} />
          )}
        </AnnotationGroup>
      </FooterRow>
    </Stack>
  );
}
