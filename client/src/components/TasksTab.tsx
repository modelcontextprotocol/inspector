import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Task } from "@modelcontextprotocol/sdk/types.js";
import {
  AlertCircle,
  RefreshCw,
  XCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
} from "lucide-react";
import ListPane from "./ListPane";
import { useState } from "react";
import JsonView from "./JsonView";
import { cn } from "@/lib/utils";

const TaskStatusIcon = ({ status }: { status: Task["status"] }) => {
  switch (status) {
    case "working":
      return <Clock className="h-4 w-4 animate-pulse text-blue-500" />;
    case "input_required":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "cancelled":
      return <XCircle className="h-4 w-4 text-gray-500" />;
    default:
      return <PlayCircle className="h-4 w-4" />;
  }
};

const TasksTab = ({
  tasks,
  listTasks,
  clearTasks,
  cancelTask,
  selectedTask,
  setSelectedTask,
  error,
  nextCursor,
}: {
  tasks: Task[];
  listTasks: () => void;
  clearTasks: () => void;
  cancelTask: (taskId: string) => Promise<void>;
  selectedTask: Task | null;
  setSelectedTask: (task: Task | null) => void;
  error: string | null;
  nextCursor?: string;
}) => {
  const [isCancelling, setIsCancelling] = useState<string | null>(null);

  const displayedTask = selectedTask
    ? tasks.find((t) => t.taskId === selectedTask.taskId) || selectedTask
    : null;

  const handleCancel = async (taskId: string) => {
    setIsCancelling(taskId);
    try {
      await cancelTask(taskId);
    } finally {
      setIsCancelling(null);
    }
  };

  return (
    <TabsContent value="tasks" className="flex-1 overflow-hidden p-0 m-0">
      <div className="flex h-full overflow-hidden p-4 gap-4">
        <div className="w-1/3">
          <ListPane
            title="Tasks"
            items={tasks}
            setSelectedItem={setSelectedTask}
            listItems={listTasks}
            clearItems={clearTasks}
            buttonText={nextCursor ? "List More Tasks" : "List Tasks"}
            isButtonDisabled={!nextCursor && tasks.length > 0}
            renderItem={(task) => (
              <div className="flex items-center gap-2 overflow-hidden w-full">
                <TaskStatusIcon status={task.status} />
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate font-medium">{task.taskId}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {task.status} -{" "}
                    {new Date(task.lastUpdatedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-background border border-border rounded-lg">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {displayedTask ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Task Details
                  </h2>
                  <p className="text-muted-foreground">
                    ID: {displayedTask.taskId}
                  </p>
                </div>
                {(displayedTask.status === "working" ||
                  displayedTask.status === "input_required") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Cancel task ${displayedTask.taskId}`}
                    onClick={() => handleCancel(displayedTask.taskId)}
                    disabled={isCancelling === displayedTask.taskId}
                  >
                    {isCancelling === displayedTask.taskId ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="mr-2 h-4 w-4" />
                    )}
                    Cancel Task
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Status
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <TaskStatusIcon status={displayedTask.status} />
                    <span
                      className={cn(
                        "font-semibold capitalize",
                        displayedTask.status === "working" && "text-blue-500",
                        displayedTask.status === "completed" &&
                          "text-green-500",
                        displayedTask.status === "failed" && "text-red-500",
                        displayedTask.status === "cancelled" && "text-gray-500",
                        displayedTask.status === "input_required" &&
                          "text-yellow-500",
                      )}
                    >
                      {displayedTask.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Last Updated
                  </p>
                  <p className="mt-1 font-medium">
                    {new Date(displayedTask.lastUpdatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Created At
                  </p>
                  <p className="mt-1 font-medium">
                    {new Date(displayedTask.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    TTL
                  </p>
                  <p className="mt-1 font-medium">
                    {displayedTask.ttl === null
                      ? "Infinite"
                      : `${displayedTask.ttl}ms`}
                  </p>
                </div>
              </div>

              {displayedTask.statusMessage && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Status Message
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {displayedTask.statusMessage}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Full Task Object</h3>
                <div className="rounded-md border">
                  <JsonView data={displayedTask} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Clock className="mx-auto mb-4 h-12 w-12 opacity-20" />
                <h3 className="text-lg font-medium">No Task Selected</h3>
                <p>Select a task from the list to view its details.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={listTasks}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Tasks
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default TasksTab;
