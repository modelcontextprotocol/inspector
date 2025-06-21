import {
  CallToolResultSchema,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import JsonView from "./JsonView";

interface ToolResultProps {
  toolResult: CompatibilityCallToolResult | null;
}

const ToolResult = ({ toolResult }: ToolResultProps) => {
  if (!toolResult) return null;

  if ("content" in toolResult) {
    const parsedResult = CallToolResultSchema.safeParse(toolResult);
    if (!parsedResult.success) {
      return (
        <>
          <h4 className="font-semibold mb-2">Invalid Tool Result:</h4>
          <JsonView data={toolResult} />
          <h4 className="font-semibold mb-2">Errors:</h4>
          {parsedResult.error.errors.map((error, idx) => (
            <JsonView data={error} key={idx} />
          ))}
        </>
      );
    }
    const structuredResult = parsedResult.data;
    const isError = structuredResult.isError ?? false;

    return (
      <>
        <h4 className="font-semibold mb-2">
          Tool Result:{" "}
          {isError ? (
            <span className="text-red-600 font-semibold">Error</span>
          ) : (
            <span className="text-green-600 font-semibold">Success</span>
          )}
        </h4>
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
              (item.resource?.mimeType?.startsWith("audio/") ? (
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
          </div>
        ))}
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

export default ToolResult;
