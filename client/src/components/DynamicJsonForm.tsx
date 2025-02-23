import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JsonEditor from "./JsonEditor";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchemaType = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  properties?: Record<string, JsonSchemaType>;
  items?: JsonSchemaType;
};

type JsonObject = { [key: string]: JsonValue };

interface DynamicJsonFormProps {
  schema: JsonSchemaType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  maxDepth?: number;
}

const formatFieldLabel = (key: string): string => {
  return key
    .replace(/([A-Z])/g, " $1") // Insert space before capital letters
    .replace(/_/g, " ") // Replace underscores with spaces
    .replace(/^\w/, (c) => c.toUpperCase()); // Capitalize first letter
};

const DynamicJsonForm = ({
  schema,
  value,
  onChange,
  maxDepth = 3,
}: DynamicJsonFormProps) => {
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonError, setJsonError] = useState<string>();

  const generateDefaultValue = (propSchema: JsonSchemaType): JsonValue => {
    switch (propSchema.type) {
      case "string":
        return "";
      case "number":
      case "integer":
        return 0;
      case "boolean":
        return false;
      case "array":
        return [];
      case "object": {
        const obj: JsonObject = {};
        if (propSchema.properties) {
          Object.entries(propSchema.properties).forEach(([key, prop]) => {
            obj[key] = generateDefaultValue(prop);
          });
        }
        return obj;
      }
      default:
        return null;
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
      case "number":
      case "integer":
        return (
          <Input
            type={propSchema.type === "string" ? "text" : "number"}
            value={(currentValue as string | number) ?? ""}
            onChange={(e) =>
              handleFieldChange(
                path,
                propSchema.type === "string"
                  ? e.target.value
                  : Number(e.target.value),
              )
            }
            placeholder={propSchema.description}
          />
        );
      case "boolean":
        return (
          <Input
            type="checkbox"
            checked={(currentValue as boolean) ?? false}
            onChange={(e) => handleFieldChange(path, e.target.checked)}
            className="w-4 h-4"
          />
        );
      case "object":
        if (!propSchema.properties) return null;
        return (
          <div className="space-y-4 border rounded-md p-4">
            {Object.entries(propSchema.properties).map(([key, prop]) => (
              <div key={key} className="space-y-2">
                <Label>{formatFieldLabel(key)}</Label>
                {renderFormFields(
                  prop,
                  (currentValue as JsonObject)?.[key],
                  [...path, key],
                  depth + 1,
                )}
              </div>
            ))}
          </div>
        );
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
                  handleFieldChange(path, [
                    ...arrayValue,
                    generateDefaultValue(propSchema.items as JsonSchemaType),
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

    const updateArray = (array: JsonValue[], path: string[], value: JsonValue): JsonValue[] => {
      const [index, ...restPath] = path;
      const arrayIndex = Number(index);

      // Validate array index
      if (isNaN(arrayIndex)) {
        console.error(`Invalid array index: ${index}`);
        return array;
      }

      // Check array bounds
      if (arrayIndex < 0) {
        console.error(`Array index out of bounds: ${arrayIndex} < 0`);
        return array;
      }

      const newArray = [...array];
      
      if (restPath.length === 0) {
        newArray[arrayIndex] = value;
      } else {
        // Ensure index position exists
        if (arrayIndex >= array.length) {
          console.warn(`Extending array to index ${arrayIndex}`);
          newArray.length = arrayIndex + 1;
          newArray.fill(null, array.length, arrayIndex);
        }
        newArray[arrayIndex] = updateValue(newArray[arrayIndex], restPath, value);
      }
      return newArray;
    };

    const updateObject = (obj: JsonObject, path: string[], value: JsonValue): JsonObject => {
      const [key, ...restPath] = path;
      
      // Validate object key
      if (typeof key !== 'string') {
        console.error(`Invalid object key: ${key}`);
        return obj;
      }

      const newObj = { ...obj };
      
      if (restPath.length === 0) {
        newObj[key] = value;
      } else {
        // Ensure key exists
        if (!(key in newObj)) {
          console.warn(`Creating new key in object: ${key}`);
          newObj[key] = {};
        }
        newObj[key] = updateValue(newObj[key], restPath, value);
      }
      return newObj;
    };

    const updateValue = (current: JsonValue, path: string[], value: JsonValue): JsonValue => {
      if (path.length === 0) return value;

      try {
        if (!current) {
          current = !isNaN(Number(path[0])) ? [] : {};
        }

        // Type checking
        if (Array.isArray(current)) {
          return updateArray(current, path, value);
        } else if (typeof current === 'object' && current !== null) {
          return updateObject(current, path, value);
        } else {
          console.error(`Cannot update path ${path.join('.')} in non-object/array value:`, current);
          return current;
        }
      } catch (error) {
        console.error(`Error updating value at path ${path.join('.')}:`, error);
        return current;
      }
    };

    try {
      const newValue = updateValue(value, path, fieldValue);
      onChange(newValue);
    } catch (error) {
      console.error('Failed to update form value:', error);
      // Keep the original value unchanged
      onChange(value);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsJsonMode(!isJsonMode)}
        >
          {isJsonMode ? "Switch to Form" : "Switch to JSON"}
        </Button>
      </div>

      {isJsonMode ? (
        <JsonEditor
          value={JSON.stringify(value ?? generateDefaultValue(schema), null, 2)}
          onChange={(newValue) => {
            try {
              onChange(JSON.parse(newValue));
              setJsonError(undefined);
            } catch (err) {
              setJsonError(err instanceof Error ? err.message : "Invalid JSON");
            }
          }}
          error={jsonError}
        />
      ) : (
        renderFormFields(schema, value)
      )}
    </div>
  );
};

export default DynamicJsonForm;
