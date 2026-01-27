import JsonView from "./JsonView";
import ResourceLinkView from "./ResourceLinkView";
import {
  CallToolResultSchema,
  CompatibilityCallToolResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { validateToolOutput, hasOutputSchema } from "@/utils/schemaUtils";

interface ToolResultsProps {
  toolResult: CompatibilityCallToolResult | null;
  selectedTool: Tool | null;
  resourceContent: Record<string, string>;
  onReadResource?: (uri: string) => void;
  isPollingTask?: boolean;
}

const ToolResults = ({
  toolResult,
  selectedTool,
  resourceContent,
  onReadResource,
  isPollingTask,
}: ToolResultsProps) => {
  if (!toolResult) return null;

  if ("content" in toolResult) {
    const parsedResult = CallToolResultSchema.safeParse(toolResult);
    if (!parsedResult.success) {
      return (
        <>
          <h4 className="font-semibold mb-2">Invalid Tool Result:</h4>
          <JsonView data={toolResult} />
          <h4 className="font-semibold mb-2">Errors:</h4>
          {parsedResult.error.issues.map((issue, idx) => (
            <JsonView data={issue} key={idx} />
          ))}
        </>
      );
    }
    const structuredResult = parsedResult.data;
    const isError = structuredResult.isError ?? false;

    // Check if this is a running task
    const relatedTask = structuredResult._meta?.[
      "io.modelcontextprotocol/related-task"
    ] as { taskId: string } | undefined;
    const isTaskRunning =
      isPollingTask ||
      (!!relatedTask &&
        structuredResult.content.some(
          (c) =>
            c.type === "text" &&
            (c.text?.includes("Polling") || c.text?.includes("Task status")),
        ));

    let validationResult = null;
    const toolHasOutputSchema =
      selectedTool && hasOutputSchema(selectedTool.name);

    if (toolHasOutputSchema) {
      if (!structuredResult.structuredContent && !isError) {
        validationResult = {
          isValid: false,
          error:
            "Tool has an output schema but did not return structured content",
        };
      } else if (structuredResult.structuredContent) {
        validationResult = validateToolOutput(
          selectedTool.name,
          structuredResult.structuredContent,
        );
      }
    }

    return (
      <>
        <h4 className="font-semibold mb-2">
          Tool Result:{" "}
          {isError ? (
            <span className="text-red-600 font-semibold">Error</span>
          ) : isTaskRunning ? (
            <span className="text-yellow-600 font-semibold">Task Running</span>
          ) : (
            <span className="text-green-600 font-semibold">Success</span>
          )}
        </h4>
        {structuredResult.structuredContent && (
          <div className="mb-4">
            <h5 className="font-semibold mb-2 text-sm">Structured Content:</h5>
            <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
              <JsonView data={structuredResult.structuredContent} />
              {validationResult && (
                <div
                  className={`mt-2 p-2 rounded text-sm ${
                    validationResult.isValid
                      ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
                      : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                  }`}
                >
                  {validationResult.isValid ? (
                    "✓ Valid according to output schema"
                  ) : (
                    <>✗ Validation Error: {validationResult.error}</>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {structuredResult._meta && (
          <div className="mb-4">
            <h5 className="font-semibold mb-2 text-sm">Meta:</h5>
            <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
              <JsonView data={structuredResult._meta} />
            </div>
          </div>
        )}
        {!structuredResult.structuredContent &&
          validationResult &&
          !validationResult.isValid && (
            <div className="mb-4">
              <div className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 p-2 rounded text-sm">
                ✗ Validation Error: {validationResult.error}
              </div>
            </div>
          )}
        {structuredResult.content.length > 0 &&
          !structuredResult.structuredContent && (
            <div className="mb-4">
              {structuredResult.content.map((item, index) => (
                <div key={index} className="mb-2">
                  {item.type === "text" && (
                    <JsonView data={item.text} isError={isError} />
                  )}
                  {item.type === "image" && (
                    <img
                      src={`data:${item.mimeType};base64,${item.data}`}
                      alt="Tool result image"
                      className="max-w-full h-auto"
                    />
                  )}
                  {item.type === "resource" &&
                    (item.resource?.mimeType?.startsWith("audio/") &&
                    "blob" in item.resource ? (
                      <audio
                        controls
                        src={`data:${item.resource.mimeType};base64,${item.resource.blob}`}
                        className="w-full"
                      >
                        <p>Your browser does not support audio playback</p>
                      </audio>
                    ) : (
                      <JsonView data={item.resource} />
                    ))}
                  {item.type === "resource_link" && (
                    <ResourceLinkView
                      uri={item.uri}
                      name={item.name}
                      description={item.description}
                      mimeType={item.mimeType}
                      resourceContent={resourceContent[item.uri] || ""}
                      onReadResource={onReadResource}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
      </>
    );
  } else if ("toolResult" in toolResult) {
    return (
      <>
        <h4 className="font-semibold mb-2">Tool Result (Legacy):</h4>
        <JsonView data={toolResult.toolResult} />
      </>
    );
  }

  return null;
};

export default ToolResults;
