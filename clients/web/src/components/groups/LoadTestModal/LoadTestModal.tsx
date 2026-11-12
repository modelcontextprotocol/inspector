import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Code,
  Group,
  Input,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  formatLoadProgress,
  type LoadProgress,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import type { LoadStepBy } from "@inspector/core/cli/handlers/load-stages.js";
import type { RunLoadTest } from "../../../lib/loadTest";
import {
  buildLoadTestRequest,
  DEFAULT_LOAD_TEST_FORM,
  isSteppedLoad,
  type LoadTestFormValues,
  type LoadTestTarget,
  type LoadTestTool,
} from "../../../utils/loadTest";
import { LoadTestSummary } from "../LoadTestSummary/LoadTestSummary";

/**
 * The web load panel (#2911): drive the shared `--load` engine over the
 * current connection — the selected tool with the Tools form's arguments, or
 * a pasted scenario — set its concurrency, duration and rate, watch progress,
 * and read the summary as tables. The run itself is `onRun`, so this
 * component holds only the form and the run's state.
 */
export interface LoadTestModalProps {
  opened: boolean;
  /** The Tools screen's selection; absent, only a scenario can be run. */
  tool?: LoadTestTool;
  onRun: RunLoadTest;
  onClose: () => void;
}

type RunState =
  | { phase: "idle" }
  | { phase: "running"; progress?: LoadProgress }
  | { phase: "done"; summary: LoadSummary }
  | { phase: "failed"; error: string };

/** The target switch: the tool named when there is one, else disabled. */
function targetOptions(
  tool: LoadTestTool | undefined,
): { value: LoadTestTarget; label: string; disabled?: boolean }[] {
  return [
    tool
      ? { value: "tool", label: `Tool: ${tool.name}` }
      : { value: "tool", label: "Tool", disabled: true },
    { value: "scenario", label: "Scenario" },
  ];
}

const STEP_BY_OPTIONS: { value: LoadStepBy; label: string }[] = [
  { value: "concurrency", label: "Concurrency" },
  { value: "rate", label: "Rate" },
];

const SCENARIO_PLACEHOLDER = `[
  { "method": "tools/call", "tool": "echo", "args": { "message": "hi {{seq}}" }, "weight": 3 },
  { "method": "resources/read", "uri": "demo://resource/1" }
]`;

const LoadModal = Modal.withProps({
  size: "xl",
  title: "Load test",
});

const BodyStack = Stack.withProps({ gap: "md" });

const FieldGrid = SimpleGrid.withProps({ cols: 3, spacing: "sm" });

const HintText = Text.withProps({ size: "sm", c: "dimmed" });

const ScenarioInput = Textarea.withProps({
  label: "Scenario",
  description:
    "A weighted mix of tools/call, resources/read and prompts/get steps, as the CLI's --load-scenario file takes.",
  autosize: true,
  minRows: 6,
  maxRows: 14,
  variant: "code",
});

const PositiveInput = NumberInput.withProps({ min: 0, allowNegative: false });

const WholeInput = NumberInput.withProps({
  min: 1,
  allowNegative: false,
  allowDecimal: false,
});

const FormError = Text.withProps({ size: "sm", c: "red" });

const Footer = Group.withProps({ justify: "flex-start", gap: "sm" });

const StopButton = Button.withProps({ variant: "light", color: "red" });

const ProgressText = Text.withProps({ size: "sm", ff: "monospace" });

const FailedAlert = Alert.withProps({
  variant: "light",
  color: "red",
  title: "The load test could not run",
});

/**
 * The modal's body, split out so the form and the run are owned by a
 * component Mantine unmounts on close: reopening starts clean, and unmounting
 * stops a run still going.
 */
function LoadTestForm({
  tool,
  onRun,
}: Pick<LoadTestModalProps, "tool" | "onRun">) {
  const [values, setValues] = useState<LoadTestFormValues>(() => ({
    ...DEFAULT_LOAD_TEST_FORM,
    target: tool ? "tool" : "scenario",
  }));
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  // Closing the modal mid-run stops the run: its calls go over the user's
  // live connection, and nothing would be left to show the result.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const built = buildLoadTestRequest(values, tool);
  const running = run.phase === "running";
  const stepped = isSteppedLoad(values);
  const set = (patch: Partial<LoadTestFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  const start = () => {
    /* v8 ignore next -- Start is disabled while the form is invalid */
    if (!built.ok) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRun({ phase: "running" });
    onRun(built.request, {
      signal: controller.signal,
      onProgress: (progress) => setRun({ phase: "running", progress }),
    }).then(
      (summary) => setRun({ phase: "done", summary }),
      (err: unknown) =>
        setRun({
          phase: "failed",
          error: err instanceof Error ? err.message : String(err),
        }),
    );
  };

  return (
    <BodyStack>
      <SegmentedControl
        aria-label="Load target"
        data={targetOptions(tool)}
        value={values.target}
        disabled={running}
        onChange={(value) => set({ target: value as LoadTestTarget })}
      />
      {values.target === "tool" ? (
        <HintText>
          Each call sends the arguments currently in the Tools form, with{" "}
          <Code>{"{{seq}}"}</Code>, <Code>{"{{worker}}"}</Code>,{" "}
          <Code>{"{{uuid}}"}</Code> and <Code>{"{{rand:1-100}}"}</Code> filled
          in per call.
        </HintText>
      ) : (
        <ScenarioInput
          placeholder={SCENARIO_PLACEHOLDER}
          value={values.scenarioText}
          disabled={running}
          onChange={(event) => set({ scenarioText: event.currentTarget.value })}
        />
      )}

      <HintText>
        Calls go over this connection, through the Inspector&apos;s backend, and
        the page records each one in the monitoring sidebar, so latencies
        include both. Close the sidebar to measure the server rather than this
        page.
      </HintText>

      <FieldGrid>
        <WholeInput
          label="Concurrency"
          description={
            stepped && values.stepBy === "concurrency"
              ? "Set by the steps"
              : "Calls in flight at once"
          }
          value={values.concurrency}
          disabled={running || (stepped && values.stepBy === "concurrency")}
          onChange={(value) => set({ concurrency: value })}
        />
        {!(stepped && values.stepBy === "rate") && (
          <PositiveInput
            label="Rate (calls/s)"
            description="Empty for as fast as possible"
            value={values.rate}
            disabled={running}
            onChange={(value) => set({ rate: value })}
          />
        )}
        {!stepped && (
          <>
            <PositiveInput
              label="Duration (s)"
              description="Stop starting calls after this long"
              value={values.durationSec}
              disabled={running}
              onChange={(value) => set({ durationSec: value })}
            />
            <WholeInput
              label="Requests"
              description="Stop after this many calls"
              value={values.requests}
              disabled={running}
              onChange={(value) => set({ requests: value })}
            />
            <PositiveInput
              label="Warm-up (s)"
              description="Run first, left out of the figures"
              value={values.warmupSec}
              disabled={running}
              onChange={(value) => set({ warmupSec: value })}
            />
          </>
        )}
      </FieldGrid>

      <FieldGrid>
        <TextInput
          label="Steps"
          description="Comma-separated levels, one stage each"
          placeholder="5,10,20"
          value={values.steps}
          disabled={running}
          onChange={(event) => set({ steps: event.currentTarget.value })}
        />
        {stepped && (
          <>
            <Input.Wrapper label="Step by" description="What each level sets">
              <SegmentedControl
                aria-label="Step by"
                data={STEP_BY_OPTIONS}
                value={values.stepBy}
                disabled={running}
                onChange={(value) => set({ stepBy: value as LoadStepBy })}
              />
            </Input.Wrapper>
            <PositiveInput
              label="Step duration (s)"
              description="How long each stage runs"
              value={values.stepDurationSec}
              disabled={running}
              onChange={(value) => set({ stepDurationSec: value })}
            />
          </>
        )}
      </FieldGrid>

      {!built.ok && <FormError role="alert">{built.error}</FormError>}

      <Footer>
        <Button
          disabled={!built.ok || running}
          loading={running}
          onClick={start}
        >
          Start
        </Button>
        {running && (
          <StopButton onClick={() => controllerRef.current?.abort()}>
            Stop
          </StopButton>
        )}
      </Footer>

      {run.phase === "running" && (
        <ProgressText aria-live="polite">
          {run.progress ? formatLoadProgress(run.progress) : "Starting…"}
        </ProgressText>
      )}
      {run.phase === "failed" && <FailedAlert>{run.error}</FailedAlert>}
      {run.phase === "done" && <LoadTestSummary summary={run.summary} />}
      {run.phase === "idle" && (
        <HintText>
          The same engine as the CLI&apos;s <Code>--load</Code>: workers share
          one counter, so concurrency caps the calls in flight and the rate
          spaces their starts evenly.
        </HintText>
      )}
    </BodyStack>
  );
}

export function LoadTestModal({
  opened,
  tool,
  onRun,
  onClose,
}: LoadTestModalProps) {
  return (
    <LoadModal opened={opened} onClose={onClose}>
      <LoadTestForm tool={tool} onRun={onRun} />
    </LoadModal>
  );
}
