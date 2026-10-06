/**
 * Tasks tab (#2432): the TUI's view of requestor tasks — the tasks this client
 * created on the server, whether through a task-augmented call or a server that
 * answered an ordinary call with a task handle.
 *
 * Deliberately thin: the list and its live updates come from core's
 * `ManagedRequestorTasksState` (through `useManagedRequestorTasks` in `App`),
 * and every action here is one `InspectorClient` call. Nothing about task
 * lifecycle is decided in this file — a cancelled task stays cancelled because
 * the store pins it, not because this view remembers.
 *
 * Keys are chosen to avoid every tab accelerator and the global `c`/`d`, since
 * App's handler sees each keypress too: `x` cancel, `f` refresh, `l` clear
 * completed, Enter fetch the result, `+` zoom.
 */
import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { CallToolResult, Task } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { useSelectableList } from "../hooks/useSelectableList.js";

/** Glyph and color per task status; unknown statuses fall back to gray. */
const STATUS_STYLE: Record<string, { glyph: string; color: string }> = {
  working: { glyph: "◐", color: "yellow" },
  input_required: { glyph: "?", color: "magenta" },
  completed: { glyph: "●", color: "green" },
  failed: { glyph: "✗", color: "red" },
  cancelled: { glyph: "○", color: "gray" },
};

export function taskStatusStyle(status: string): {
  glyph: string;
  color: string;
} {
  return STATUS_STYLE[status] ?? { glyph: "·", color: "gray" };
}

/** A task the server may still be working on — the only kind worth cancelling. */
export function isTaskActive(status: string): boolean {
  return status === "working" || status === "input_required";
}

/** A task with a terminal outcome the server can hand back via `tasks/result`. */
export function hasTaskResult(status: string): boolean {
  return status === "completed" || status === "failed";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface TasksTabProps {
  tasks: Task[];
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  focusedPane?: "list" | "details" | null;
  modalOpen?: boolean;
  /** Re-list (or re-poll) tasks — `useManagedRequestorTasks().refresh`. */
  onRefresh: () => Promise<unknown>;
  /** Drop terminal tasks — `useManagedRequestorTasks().clearCompleted`. */
  onClearCompleted: () => void;
  onViewDetails?: (task: Task, result: CallToolResult | null) => void;
  onAuthRecoveryRequired?: (error: AuthRecoveryRequiredError) => void;
}

export function TasksTab({
  tasks,
  inspectorClient,
  width,
  height,
  focusedPane = null,
  modalOpen = false,
  onRefresh,
  onClearCompleted,
  onViewDetails,
  onAuthRecoveryRequired,
}: TasksTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    tasks.length,
    visibleCount,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Result fetched for one task id; a different selection shows none.
  const [result, setResult] = useState<{
    taskId: string;
    value: CallToolResult;
  } | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  const selectedTask = tasks[selectedIndex] ?? null;
  const selectedResult =
    result && selectedTask && result.taskId === selectedTask.taskId
      ? result.value
      : null;

  // One operation at a time. A ref rather than `busy`, because two keypresses
  // can land before the state update re-renders, and overlapping refreshes
  // walk the store's paginated list concurrently and duplicate rows.
  const inFlightRef = useRef(false);

  /** Run one task operation, routing auth recovery and errors uniformly. */
  const run = async (label: string, op: () => Promise<void>) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(label);
    setError(null);
    try {
      await op();
    } catch (err) {
      if (err instanceof AuthRecoveryRequiredError) {
        onAuthRecoveryRequired?.(err);
        return;
      }
      setError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  useInput(
    (input: string, key: Key) => {
      if (input === "f") {
        // `run` owns every rejection (its catch surfaces the message), and a
        // key handler cannot await.
        void run("Refreshing…", async () => {
          await onRefresh();
        });
        return;
      }
      if (input === "l") {
        // Not during a refresh: the store has already emptied its list for the
        // page walk, so a clear now is lost and the tasks reappear after it.
        if (inFlightRef.current) return;
        onClearCompleted();
        return;
      }
      if (input === "x" && selectedTask && inspectorClient) {
        if (!isTaskActive(selectedTask.status)) return;
        const { taskId } = selectedTask;
        void run("Cancelling…", () =>
          inspectorClient.cancelRequestorTask(taskId),
        );
        return;
      }
      if (key.return && selectedTask && inspectorClient) {
        if (!hasTaskResult(selectedTask.status)) return;
        const { taskId } = selectedTask;
        void run("Fetching result…", async () => {
          const value = await inspectorClient.getRequestorTaskResult(taskId);
          setResult({ taskId, value });
        });
        return;
      }

      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < tasks.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }

      // Only "details" remains: the hook is inactive for any other pane.
      if (input === "+" && selectedTask && onViewDetails) {
        onViewDetails(selectedTask, selectedResult);
        return;
      }
      if (key.upArrow) {
        scrollViewRef.current?.scrollBy(-1);
      } else if (key.downArrow) {
        scrollViewRef.current?.scrollBy(1);
      } else if (key.pageUp) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(-viewportHeight);
      } else if (key.pageDown) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(viewportHeight);
      }
    },
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );

  // Reset scroll when selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const selectedStyle = selectedTask
    ? taskStatusStyle(selectedTask.status)
    : null;

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Task list */}
      <Box
        width={listWidth}
        height={height}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={true}
        flexDirection="column"
        paddingX={1}
      >
        <Box paddingY={1}>
          <Text
            bold
            backgroundColor={focusedPane === "list" ? "yellow" : undefined}
          >
            Tasks ({tasks.length})
          </Text>
        </Box>
        {tasks.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No tasks yet (f to refresh)</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {tasks
              .slice(firstVisible, firstVisible + visibleCount)
              .map((task, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                const style = taskStatusStyle(task.status);
                return (
                  <Box key={task.taskId} paddingY={0} flexShrink={0}>
                    <Text wrap="truncate">
                      {isSelected ? "▶ " : "  "}
                      <Text color={style.color}>{style.glyph}</Text>{" "}
                      {task.taskId}
                    </Text>
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      {/* Task details */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selectedTask && selectedStyle ? (
          <>
            <Box flexShrink={0} paddingTop={1}>
              <Text
                bold
                wrap="truncate"
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedTask.taskId}
              </Text>
            </Box>

            <ScrollView ref={scrollViewRef} height={height - 5}>
              <Box marginTop={1} flexShrink={0}>
                <Text>
                  Status:{" "}
                  <Text color={selectedStyle.color} bold>
                    {selectedTask.status}
                  </Text>
                </Text>
              </Box>
              {selectedTask.statusMessage && (
                <Box flexShrink={0}>
                  <Text dimColor>{selectedTask.statusMessage}</Text>
                </Box>
              )}
              <Box flexShrink={0}>
                <Text dimColor>Created: {selectedTask.createdAt}</Text>
              </Box>
              {selectedTask.lastUpdatedAt && (
                <Box flexShrink={0}>
                  <Text dimColor>Updated: {selectedTask.lastUpdatedAt}</Text>
                </Box>
              )}
              <Box flexShrink={0}>
                <Text dimColor>
                  TTL: {selectedTask.ttl === null ? "none" : selectedTask.ttl}
                  {selectedTask.pollInterval !== undefined &&
                    `  Poll: ${selectedTask.pollInterval}ms`}
                </Text>
              </Box>
              {busy && (
                <Box marginTop={1} flexShrink={0}>
                  <Text color="yellow">{busy}</Text>
                </Box>
              )}
              {error && (
                <Box marginTop={1} flexShrink={0}>
                  <Text color="red">{error}</Text>
                </Box>
              )}
              {selectedResult && (
                <Box marginTop={1} flexShrink={0} flexDirection="column">
                  <Text bold>Result:</Text>
                  <Box paddingLeft={2}>
                    <Text dimColor>
                      {JSON.stringify(selectedResult, null, 2)}
                    </Text>
                  </Box>
                </Box>
              )}
            </ScrollView>

            <Box
              flexShrink={0}
              height={1}
              justifyContent="center"
              backgroundColor="gray"
            >
              <Text bold color="white" wrap="truncate">
                {[
                  hasTaskResult(selectedTask.status) && "Enter result",
                  isTaskActive(selectedTask.status) && "x cancel",
                  "f refresh",
                  "l clear done",
                  focusedPane === "details" && "+ zoom",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </Box>
          </>
        ) : (
          <Box paddingY={1} flexShrink={0} flexDirection="column">
            <Text dimColor>Select a task to view details</Text>
            {busy && <Text color="yellow">{busy}</Text>}
            {error && <Text color="red">{error}</Text>}
          </Box>
        )}
      </Box>
    </Box>
  );
}
