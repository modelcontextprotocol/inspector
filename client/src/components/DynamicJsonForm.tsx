import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JsonEditor from "./JsonEditor";
import { updateValueAtPath, JsonObject } from "@/utils/jsonPathUtils";
import { generateDefaultValue, formatFieldLabel } from "@/utils/schemaUtils";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchemaType = {
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null";
  description?: string;
  required?: boolean;
  default?: JsonValue;
  properties?: Record<string, JsonSchemaType>;
  items?: JsonSchemaType;
};

interface DynamicJsonFormProps {
  schema: JsonSchemaType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  maxDepth?: number;
}

const DynamicJsonForm = ({
  schema,
  value,
  onChange,
  maxDepth = 3,
}: DynamicJsonFormProps) => {
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonError, setJsonError] = useState<string>();
  // Add state for storing raw JSON value
  const [rawJsonValue, setRawJsonValue] = useState<string>(
    JSON.stringify(value ?? generateDefaultValue(schema), null, 2),
  );

  // Update rawJsonValue when value prop changes
  useEffect(() => {
    if (!isJsonMode) {
      setRawJsonValue(
        JSON.stringify(value ?? generateDefaultValue(schema), null, 2),
      );
    }
  }, [value, schema, isJsonMode]);

  const handleSwitchToFormMode = () => {
    if (isJsonMode) {
      // When switching to Form mode, ensure we have valid JSON
      try {
        const parsed = JSON.parse(rawJsonValue);
        // Update the parent component's state with the parsed value
        onChange(parsed);
        // Switch to form mode
        setIsJsonMode(false);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      }
    } else {
      // Update raw JSON value when switching to JSON mode
      setRawJsonValue(
        JSON.stringify(value ?? generateDefaultValue(schema), null, 2),
      );
      setIsJsonMode(true);
    }
  };

  const renderFormFields = (
    propSchema: JsonSchemaType,
    currentValue: JsonValue,
    path: string[] = [],
    depth: number = 0,
  ) => {
    if (
      depth >= maxDepth &&
      (propSchema.type === "object" || propSchema.type === "array")
    ) {
      // Render as JSON editor when max depth is reached
      return (
        <JsonEditor
          value={JSON.stringify(
            currentValue ?? generateDefaultValue(propSchema),
            null,
            2,
          )}
          onChange={(newValue) => {
            try {
              const parsed = JSON.parse(newValue);
              handleFieldChange(path, parsed);
              setJsonError(undefined);
            } catch (err) {
              setJsonError(err instanceof Error ? err.message : "Invalid JSON");
            }
          }}
          error={jsonError}
        />
      );
    }

    switch (propSchema.type) {
      case "string":
        return (
          <Input
            type="text"
            value={(currentValue as string) ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val && !propSchema.required) {
                handleFieldChange(path, undefined);
              } else {
                handleFieldChange(path, val);
              }
            }}
            placeholder={propSchema.description}
            required={propSchema.required}
          />
        );
      case "number":
        return (
          <Input
            type="number"
            value={(currentValue as number)?.toString() ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val && !propSchema.required) {
                handleFieldChange(path, undefined);
              } else {
                const num = Number(val);
                if (!isNaN(num)) {
                  handleFieldChange(path, num);
                }
              }
            }}
            placeholder={propSchema.description}
            required={propSchema.required}
          />
        );
      case "integer":
        return (
          <Input
            type="number"
            step="1"
            value={(currentValue as number)?.toString() ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val && !propSchema.required) {
                handleFieldChange(path, undefined);
              } else {
                const num = Number(val);
                if (!isNaN(num) && Number.isInteger(num)) {
                  handleFieldChange(path, num);
                }
              }
            }}
            placeholder={propSchema.description}
            required={propSchema.required}
          />
        );
      case "boolean":
        return (
          <Input
            type="checkbox"
            checked={(currentValue as boolean) ?? false}
            onChange={(e) => handleFieldChange(path, e.target.checked)}
            className="w-4 h-4"
            required={propSchema.required}
          />
        );
      case "object": {
        // Handle case where we have a value but no schema properties
        const objectValue = (currentValue as JsonObject) || {};

        // If we have schema properties, use them to render fields
        if (propSchema.properties) {
          return (
            <div className="space-y-4 border rounded-md p-4">
              {Object.entries(propSchema.properties).map(([key, prop]) => (
                <div key={key} className="space-y-2">
                  <Label>{formatFieldLabel(key)}</Label>
                  {renderFormFields(
                    prop,
                    objectValue[key],
                    [...path, key],
                    depth + 1,
                  )}
                </div>
              ))}
            </div>
          );
        }
        // If we have a value but no schema properties, render fields based on the value
        else if (Object.keys(objectValue).length > 0) {
          return (
            <div className="space-y-4 border rounded-md p-4">
              {Object.entries(objectValue).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <Label>{formatFieldLabel(key)}</Label>
                  <Input
                    type="text"
                    value={String(value)}
                    onChange={(e) =>
                      handleFieldChange([...path, key], e.target.value)
                    }
                  />
                </div>
              ))}
            </div>
          );
        }
        // If we have neither schema properties nor value, return null
        return null;
      }
      case "array": {
        const arrayValue = Array.isArray(currentValue) ? currentValue : [];
        if (!propSchema.items) return null;
        return (
          <div className="space-y-4">
            {propSchema.description && (
              <p className="text-sm text-gray-600">{propSchema.description}</p>
            )}

            {propSchema.items?.description && (
              <p className="text-sm text-gray-500">
                Items: {propSchema.items.description}
              </p>
            )}

            <div className="space-y-2">
              {arrayValue.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  {renderFormFields(
                    propSchema.items as JsonSchemaType,
                    item,
                    [...path, index.toString()],
                    depth + 1,
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newArray = [...arrayValue];
                      newArray.splice(index, 1);
                      handleFieldChange(path, newArray);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const defaultValue = generateDefaultValue(
                    propSchema.items as JsonSchemaType,
                  );
                  handleFieldChange(path, [
                    ...arrayValue,
                    defaultValue ?? null,
                  ]);
                }}
                title={
                  propSchema.items?.description
                    ? `Add new ${propSchema.items.description}`
                    : "Add new item"
                }
              >
                Add Item
              </Button>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  const handleFieldChange = (path: string[], fieldValue: JsonValue) => {
    if (path.length === 0) {
      onChange(fieldValue);
      return;
    }

    try {
      const newValue = updateValueAtPath(value, path, fieldValue);
      onChange(newValue);
    } catch (error) {
      console.error("Failed to update form value:", error);
      onChange(value);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleSwitchToFormMode}>
          {isJsonMode ? "Switch to Form" : "Switch to JSON"}
        </Button>
      </div>

      {isJsonMode ? (
        <JsonEditor
          value={rawJsonValue}
          onChange={(newValue) => {
            setRawJsonValue(newValue);
            try {
              if (/^\s*[{[].*[}\]]\s*$/.test(newValue)) {
                const parsed = JSON.parse(newValue);
                onChange(parsed);
                setJsonError(undefined);
              }
            } catch {
              // Don't set an error during typing - that will happen when the user
              // tries to save or submit the form
            }
          }}
          error={jsonError}
        />
      ) : // If schema type is object but value is not an object or is empty, and we have actual JSON data,
      // render a simple representation of the JSON data
      schema.type === "object" &&
        (typeof value !== "object" ||
          value === null ||
          Object.keys(value).length === 0) &&
        rawJsonValue &&
        rawJsonValue !== "{}" ? (
        <div className="space-y-4 border rounded-md p-4">
          <p className="text-sm text-gray-500">
            Form view not available for this JSON structure. Using simplified
            view:
          </p>
          <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto">
            {rawJsonValue}
          </pre>
          <p className="text-sm text-gray-500">
            Use JSON mode for full editing capabilities.
          </p>
        </div>
      ) : (
        renderFormFields(schema, value)
      )}
    </div>
  );
};

export default DynamicJsonForm;
