import { useState, memo } from "react";
import { JsonValue } from "./DynamicJsonForm";

interface JsonViewProps {
  data: JsonValue;
  name?: string;
  initialExpandDepth?: number;
}

function tryParseJson(str: string): { success: boolean; data: JsonValue } {
  const trimmed = str.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return { success: false, data: str };
  }
  try {
    return { success: true, data: JSON.parse(str) };
  } catch {
    return { success: false, data: str };
  }
}

const JsonView = memo(
  ({ data, name, initialExpandDepth = 2 }: JsonViewProps) => {
    const normalizedData =
      typeof data === "string"
        ? tryParseJson(data).success
          ? tryParseJson(data).data
          : data
        : data;

    return (
      <div className="font-mono text-sm transition-all duration-300">
        <JsonNode
          data={normalizedData}
          name={name}
          depth={0}
          initialExpandDepth={initialExpandDepth}
        />
      </div>
    );
  },
);

JsonView.displayName = "JsonView";

interface JsonNodeProps {
  data: JsonValue;
  name?: string;
  depth: number;
  initialExpandDepth: number;
}

const JsonNode = memo(
  ({ data, name, depth = 0, initialExpandDepth }: JsonNodeProps) => {
    const [isExpanded, setIsExpanded] = useState(depth < initialExpandDepth);

    const getDataType = (value: JsonValue): string => {
      if (Array.isArray(value)) return "array";
      if (value === null) return "null";
      return typeof value;
    };

    const dataType = getDataType(data);

    const typeStyleMap: Record<string, string> = {
      number: "text-blue-600",
      boolean: "text-amber-600",
      null: "text-purple-600",
      undefined: "text-gray-600",
      string: "text-green-600",
      default: "text-gray-700",
    };

    const renderCollapsible = (isArray: boolean) => {
      const items = isArray
        ? (data as JsonValue[])
        : Object.entries(data as Record<string, JsonValue>);
      const itemCount = items.length;
      const isEmpty = itemCount === 0;

      const symbolMap = {
        open: isArray ? "[" : "{",
        close: isArray ? "]" : "}",
        collapsed: isArray ? "[ ... ]" : "{ ... }",
        empty: isArray ? "[]" : "{}",
      };

      if (isEmpty) {
        return (
          <div className="flex items-center">
            {name && (
              <span className="mr-1 text-gray-600 dark:text-gray-400">
                {name}:
              </span>
            )}
            <span className="text-gray-500">{symbolMap.empty}</span>
          </div>
        );
      }

      return (
        <div className="flex flex-col">
          <div
            className="flex items-center mr-1 rounded cursor-pointer group hover:bg-gray-800/10 dark:hover:bg-gray-800/20"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {name && (
              <span className="mr-1 text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                {name}:
              </span>
            )}
            {isExpanded ? (
              <span className="text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                {symbolMap.open}
              </span>
            ) : (
              <>
                <span className="text-gray-600 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                  {symbolMap.collapsed}
                </span>
                <span className="ml-1 text-gray-700 dark:group-hover:text-gray-100 group-hover:text-gray-400">
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
              </>
            )}
          </div>
          {isExpanded && (
            <>
              <div className="pl-2 ml-4 border-l border-gray-200 dark:border-gray-800">
                {isArray
                  ? (items as JsonValue[]).map((item, index) => (
                      <div key={index} className="my-1">
                        <JsonNode
                          data={item}
                          name={`${index}`}
                          depth={depth + 1}
                          initialExpandDepth={initialExpandDepth}
                        />
                      </div>
                    ))
                  : (items as [string, JsonValue][]).map(([key, value]) => (
                      <div key={key} className="my-1">
                        <JsonNode
                          data={value}
                          name={key}
                          depth={depth + 1}
                          initialExpandDepth={initialExpandDepth}
                        />
                      </div>
                    ))}
              </div>
              <div className="text-gray-600 dark:text-gray-400">
                {symbolMap.close}
              </div>
            </>
          )}
        </div>
      );
    };

    const renderString = (value: string) => {
      const maxLength = 100;
      const isTooLong = value.length > maxLength;

      if (!isTooLong) {
        return (
          <div className="flex mr-1 rounded hover:bg-gray-800/20">
            {name && (
              <span className="mr-1 text-gray-600 dark:text-gray-400">
                {name}:
              </span>
            )}
            <span className={typeStyleMap.string}>"{value}"</span>
          </div>
        );
      }

      return (
        <div className="flex mr-1 rounded group hover:bg-gray-800/20">
          {name && (
            <span className="mr-1 text-gray-600 dark:text-gray-400 dark:group-hover:text-gray-100 group-hover:text-gray-400">
              {name}:
            </span>
          )}
          <span
            className={`${typeStyleMap.string} cursor-pointer group-hover:text-green-500`}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Click to collapse" : "Click to expand"}
          >
            {isExpanded ? `"${value}"` : `"${value.slice(0, maxLength)}..."`}
          </span>
        </div>
      );
    };

    switch (dataType) {
      case "object":
      case "array":
        return renderCollapsible(dataType === "array");
      case "string":
        return renderString(data as string);
      default:
        return (
          <div className="flex items-center mr-1 rounded hover:bg-gray-800/20">
            {name && (
              <span className="mr-1 text-gray-600 dark:text-gray-400">
                {name}:
              </span>
            )}
            <span className={typeStyleMap[dataType] || typeStyleMap.default}>
              {data === null ? "null" : String(data)}
            </span>
          </div>
        );
    }
  },
);

JsonNode.displayName = "JsonNode";

export default JsonView;
