import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import JsonEditor from "./JsonEditor";
import { updateValueAtPath } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import { useToast } from "@/lib/hooks/useToast";
import { CheckCheck, Copy } from "lucide-react";

interface DynamicJsonFormProps {
  schema: JsonSchemaType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  maxDepth?: number;
}

const isTypeSupported = (
  type: JsonSchemaType["type"],
  supportedTypes: string[],
): boolean => {
  if (Array.isArray(type)) {
    return type.every((t) => supportedTypes.includes(t));
  }
  return typeof type === "string" && supportedTypes.includes(type);
};

const isSimpleObject = (schema: JsonSchemaType): boolean => {
  const supportedTypes = ["string", "number", "integer", "boolean", "null"];
  if (schema.type && isTypeSupported(schema.type, supportedTypes)) return true;
  if (schema.type === "object") {
    return Object.values(schema.properties ?? {}).every(
      (prop) => prop.type && isTypeSupported(prop.type, supportedTypes),
    );
  }
  if (schema.type === "array") {
    return !!schema.items && isSimpleObject(schema.items);
  }
  return false;
};

const getArrayItemDefault = (schema: JsonSchemaType): JsonValue => {
  if ("default" in schema && schema.default !== undefined) {
    return schema.default;
  }

  switch (schema.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    case "null":
      return null;
    default:
      return null;
  }
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
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const { toast } = useToast();

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
    parentSchema?: JsonSchemaType,
    propertyName?: string,
  ) => {
    if (
      depth >= maxDepth &&
      (propSchema.type === "object" || propSchema.type === "array")
    ) {
      // Render as JSON editor when max depth is reached
      return (
        <JsonEditor
          value={JSON.stringify(
            currentValue ??
              generateDefaultValue(propSchema, propertyName, parentSchema),
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

    // Check if this property is required in the parent schema
    const isRequired =
      parentSchema?.required?.includes(propertyName || "") ?? false;

    let fieldType = propSchema.type;
    if (Array.isArray(fieldType)) {
      // Of the possible types, find the first non-null type to determine the control to render
      fieldType = fieldType.find((t) => t !== "null") ?? fieldType[0];
    }

    switch (fieldType) {
      case "string": {
        if (
          propSchema.oneOf &&
          propSchema.oneOf.every(
            (option) =>
              typeof option.const === "string" &&
              typeof option.title === "string",
          )
        ) {
          return (
            <select
              value={(currentValue as string) ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (!val && !isRequired) {
                  handleFieldChange(path, undefined);
                } else {
                  handleFieldChange(path, val);
                }
              }}
              required={isRequired}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="">Select an option...</option>
              {propSchema.oneOf.map((option) => (
                <option
                  key={option.const as string}
                  value={option.const as string}
                >
                  {option.title as string}
                </option>
              ))}
            </select>
          );
        }

        if (propSchema.enum) {
          return (
            <select
              value={(currentValue as string) ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                if (!val && !isRequired) {
                  handleFieldChange(path, undefined);
                } else {
                  handleFieldChange(path, val);
                }
              }}
              required={isRequired}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="">Select an option...</option>
              {propSchema.enum.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          );
        }

        let inputType = "text";
        switch (propSchema.format) {
          case "email":
            inputType = "email";
            break;
          case "uri":
            inputType = "url";
            break;
          case "date":
            inputType = "date";
            break;
          case "date-time":
            inputType = "datetime-local";
            break;
          default:
            inputType = "text";
            break;
        }

        return (
          <Input
            type={inputType}
            value={(currentValue as string) ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              // Always allow setting string values, including empty strings
              handleFieldChange(path, val);
            }}
            placeholder={propSchema.description}
            required={isRequired}
            minLength={propSchema.minLength}
            maxLength={propSchema.maxLength}
            pattern={propSchema.pattern}
          />
        );
      }

      case "number":
        return (
          <Input
            type="number"
            value={(currentValue as number)?.toString() ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val && !isRequired) {
                handleFieldChange(path, undefined);
              } else {
                const num = Number(val);
                if (!isNaN(num)) {
                  handleFieldChange(path, num);
                }
              }
            }}
            placeholder={propSchema.description}
            required={isRequired}
            min={propSchema.minimum}
            max={propSchema.maximum}
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
              if (!val && !isRequired) {
                handleFieldChange(path, undefined);
              } else {
                const num = Number(val);
                if (!isNaN(num) && Number.isInteger(num)) {
                  handleFieldChange(path, num);
                }
              }
            }}
            placeholder={propSchema.description}
            required={isRequired}
            min={propSchema.minimum}
            max={propSchema.maximum}
          />
        );

      case "boolean":
        return (
          <Input
            type="checkbox"
            checked={(currentValue as boolean) ?? false}
            onChange={(e) => handleFieldChange(path, e.target.checked)}
            className="w-4 h-4"
            required={isRequired}
          />
        );
      case "null":
        return null;
      case "object":
        if (!propSchema.properties) {
          return (
            <JsonEditor
              value={JSON.stringify(currentValue ?? {}, null, 2)}
              onChange={(newValue) => {
                try {
                  const parsed = JSON.parse(newValue);
                  handleFieldChange(path, parsed);
                  setJsonError(undefined);
                } catch (err) {
                  setJsonError(
                    err instanceof Error ? err.message : "Invalid JSON",
                  );
                }
              }}
              error={jsonError}
            />
          );
        }

        return (
          <div className="space-y-2 border rounded p-3">
            {Object.entries(propSchema.properties).map(([key, subSchema]) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">
                  {key}
                  {propSchema.required?.includes(key) && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </label>
                {renderFormFields(
                  subSchema as JsonSchemaType,
                  (currentValue as Record<string, JsonValue>)?.[key],
                  [...path, key],
                  depth + 1,
                  propSchema,
                  key,
                )}
              </div>
            ))}
          </div>
        );
      case "array": {
        const arrayValue = Array.isArray(currentValue) ? currentValue : [];
        if (!propSchema.items) return null;

        // If the array items are simple, render as form fields, otherwise use JSON editor
        if (isSimpleObject(propSchema.items)) {
          return (
            <div className="space-y-4">
              {propSchema.description && (
                <p className="text-sm text-gray-600">
                  {propSchema.description}
                </p>
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
                    const defaultValue = getArrayItemDefault(
                      propSchema.items as JsonSchemaType,
                    );
                    handleFieldChange(path, [...arrayValue, defaultValue]);
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

        // For complex arrays, fall back to JSON editor
        return (
          <JsonEditor
            value={JSON.stringify(currentValue ?? [], null, 2)}
            onChange={(newValue) => {
              try {
                const parsed = JSON.parse(newValue);
                handleFieldChange(path, parsed);
                setJsonError(undefined);
              } catch (err) {
                setJsonError(
                  err instanceof Error ? err.message : "Invalid JSON",
                );
              }
            }}
            error={jsonError}
          />
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

  const shouldUseJsonMode =
    schema.type === "object" &&
    (!schema.properties || Object.keys(schema.properties).length === 0);

  useEffect(() => {
    if (shouldUseJsonMode && !isJsonMode) {
      setIsJsonMode(true);
    }
  }, [shouldUseJsonMode, isJsonMode]);

  const handleCopyJson = useCallback(() => {
    const copyToClipboard = async () => {
      try {
        await navigator.clipboard.writeText(
          JSON.stringify(value, null, 2) ?? "[]",
        );
        setCopiedJson(true);

        toast({
          title: "JSON copied",
          description:
            "The JSON data has been successfully copied to your clipboard.",
        });

        setTimeout(() => {
          setCopiedJson(false);
        }, 2000);
      } catch (error) {
        toast({
          title: "Error",
          description: `Failed to copy JSON: ${error instanceof Error ? error.message : String(error)}`,
          variant: "destructive",
        });
      }
    };

    copyToClipboard();
  }, [toast, value]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end space-x-2">
        {isJsonMode && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
            >
              {copiedJson ? (
                <CheckCheck className="h-4 w-4 mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Copy JSON
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={formatJson}
            >
              Format JSON
            </Button>
          </>
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
