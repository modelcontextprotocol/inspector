import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import JsonEditor from "./JsonEditor";
import { updateValueAtPath } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";

interface DynamicJsonFormProps {
  schema: JsonSchemaType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  maxDepth?: number;
}

const isSimpleObject = (schema: JsonSchemaType): boolean => {
  const supportedTypes = ["string", "number", "integer", "boolean", "null"];
  if (supportedTypes.includes(schema.type)) return true;
  if (schema.type !== "object") return false;
  return Object.values(schema.properties ?? {}).every((prop) =>
    supportedTypes.includes(prop.type),
  );
};

const DynamicJsonForm = ({
  schema,
  value,
  onChange,
  maxDepth = 3,
}: DynamicJsonFormProps) => {
  const isOnlyJSON = !isSimpleObject(schema);
  const [isJsonMode, setIsJsonMode] = useState(isOnlyJSON);
  const [jsonError, setJsonError] = useState<string>();
  // Store the raw JSON string to allow immediate feedback during typing
  // while deferring parsing until the user stops typing
  const [rawJsonValue, setRawJsonValue] = useState<string>(
    JSON.stringify(value ?? generateDefaultValue(schema), null, 2),
  );

  // Use a ref to manage debouncing timeouts to avoid parsing JSON
  // on every keystroke which would be inefficient and error-prone
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce JSON parsing and parent updates to handle typing gracefully
  const debouncedUpdateParent = useCallback(
    (jsonString: string) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set a new timeout
      timeoutRef.current = setTimeout(() => {
        try {
          const parsed = JSON.parse(jsonString);
          onChange(parsed);
          setJsonError(undefined);
        } catch {
          // Don't set error during normal typing
        }
      }, 300);
    },
    [onChange, setJsonError],
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

  const formatJson = () => {
    try {
      const jsonStr = rawJsonValue.trim();
      if (!jsonStr) {
        return;
      }
      const formatted = JSON.stringify(JSON.parse(jsonStr), null, 2);
      setRawJsonValue(formatted);
      debouncedUpdateParent(formatted);
      setJsonError(undefined);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
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
              // Allow clearing non-required fields by setting undefined
              // This preserves the distinction between empty string and unset
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
              // Allow clearing non-required number fields
              // This preserves the distinction between 0 and unset
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
              // Allow clearing non-required integer fields
              // This preserves the distinction between 0 and unset
              if (!val && !propSchema.required) {
                handleFieldChange(path, undefined);
              } else {
                const num = Number(val);
                // Only update if it's a valid integer
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

  const shouldUseJsonMode =
    schema.type === "object" &&
    (!schema.properties || Object.keys(schema.properties).length === 0);

  useEffect(() => {
    if (shouldUseJsonMode && !isJsonMode) {
      setIsJsonMode(true);
    }
  }, [shouldUseJsonMode, isJsonMode]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end space-x-2">
        {isJsonMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={formatJson}
          >
            Format JSON
          </Button>
        )}
        {!isOnlyJSON && (
          <Button variant="outline" size="sm" onClick={handleSwitchToFormMode}>
            {isJsonMode ? "Switch to Form" : "Switch to JSON"}
          </Button>
        )}
      </div>

      {isJsonMode ? (
        <JsonEditor
          value={rawJsonValue}
          onChange={(newValue) => {
            // Always update local state
            setRawJsonValue(newValue);

            // Use the debounced function to attempt parsing and updating parent
            debouncedUpdateParent(newValue);
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
