import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import JsonEditor from "./JsonEditor";
import { updateValueAtPath } from "@/utils/jsonUtils";
import {
  generateDefaultValue,
  mergeAllOf,
  resolveRef,
} from "@/utils/schemaUtils";
import type {
  JsonValue,
  JsonSchemaType,
  JsonSchemaConst,
} from "@/utils/jsonUtils";
import { useToast } from "@/lib/hooks/useToast";
import { CheckCheck, Copy } from "lucide-react";

interface DynamicJsonFormProps {
  schema: JsonSchemaType;
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  maxDepth?: number;
}

export interface DynamicJsonFormRef {
  validateJson: () => { isValid: boolean; error: string | null };
  hasJsonError: () => boolean;
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

// A oneOf whose members are full schemas is a variant union rendered with a
// selector. oneOf members carrying const are titled enum options and keep
// their existing select rendering, as do schemas that already render on
// their own (a type other than a property-less object).
const getVariantOptions = (schema: JsonSchemaType): JsonSchemaType[] | null => {
  if (!schema.oneOf || schema.oneOf.length === 0) return null;
  if (schema.oneOf.some((opt) => "const" in opt)) return null;
  if (schema.type && !(schema.type === "object" && !schema.properties)) {
    return null;
  }
  return schema.oneOf as JsonSchemaType[];
};

// Picks the variant whose properties best match the keys already present in
// the value, so an existing value does not silently render the first variant
const inferVariantIndex = (
  variants: JsonSchemaType[],
  value: JsonValue,
): number | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return undefined;

  let bestIdx: number | undefined;
  let bestScore = 0;
  variants.forEach((variant, idx) => {
    const props = variant.properties ?? {};
    const score = keys.filter((key) => key in props).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
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

const DynamicJsonForm = forwardRef<DynamicJsonFormRef, DynamicJsonFormProps>(
  ({ schema, value, onChange, maxDepth = 3 }, ref) => {
    // Merge allOf branches up front so composed schemas render like flat ones
    const resolvedSchema = useMemo(() => mergeAllOf(schema), [schema]);

    // Determine if we can render a form at the top level.
    // This is more permissive than isSimpleObject():
    // - Objects with any properties are form-capable (individual complex fields may still fallback to JSON)
    // - Arrays with defined items are form-capable
    // - Primitive types are form-capable
    // - oneOf variant unions are form-capable via the variant selector
    const canRenderTopLevelForm = (s: JsonSchemaType): boolean => {
      const primitiveTypes = ["string", "number", "integer", "boolean", "null"];

      if (getVariantOptions(s)) return true;

      const hasType = Array.isArray(s.type) ? s.type.length > 0 : !!s.type;
      if (!hasType) return false;

      const includesType = (t: string) =>
        Array.isArray(s.type)
          ? (s.type as ReadonlyArray<string>).includes(t)
          : s.type === t;

      // Primitive at top-level
      if (primitiveTypes.some(includesType)) return true;

      // Object with properties
      if (includesType("object")) {
        const keys = Object.keys(s.properties ?? {});
        return keys.length > 0;
      }

      // Array with items
      if (includesType("array")) {
        return !!s.items;
      }

      return false;
    };

    const isOnlyJSON = !canRenderTopLevelForm(resolvedSchema);
    const [isJsonMode, setIsJsonMode] = useState(isOnlyJSON);
    const [jsonError, setJsonError] = useState<string>();
    const [copiedJson, setCopiedJson] = useState<boolean>(false);
    const { toast } = useToast();

    // Store the raw JSON string to allow immediate feedback during typing
    // while deferring parsing until the user stops typing
    const [rawJsonValue, setRawJsonValue] = useState<string>(
      JSON.stringify(value ?? generateDefaultValue(resolvedSchema), null, 2),
    );
    const [numericInputDrafts, setNumericInputDrafts] = useState<
      Record<string, string>
    >({});
    const [variantSelections, setVariantSelections] = useState<
      Record<string, number>
    >({});

    // Use a ref to manage debouncing timeouts to avoid parsing JSON
    // on every keystroke which would be inefficient and error-prone
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

    const hasJsonError = () => {
      return !!jsonError;
    };

    const getPathKey = (path: string[]) =>
      path.length === 0 ? "$root" : path.join(".");

    const getNumericDisplayValue = (
      path: string[],
      currentValue: JsonValue,
    ): string => {
      const pathKey = getPathKey(path);
      if (Object.prototype.hasOwnProperty.call(numericInputDrafts, pathKey)) {
        return numericInputDrafts[pathKey];
      }
      return typeof currentValue === "number" ? currentValue.toString() : "";
    };

    const updateNumericDraft = (path: string[], draftValue: string) => {
      const pathKey = getPathKey(path);
      setNumericInputDrafts((prev) => ({ ...prev, [pathKey]: draftValue }));
    };

    const clearNumericDraft = (path: string[]) => {
      const pathKey = getPathKey(path);
      setNumericInputDrafts((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, pathKey)) {
          return prev;
        }
        const next = { ...prev };
        delete next[pathKey];
        return next;
      });
    };

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
          } catch (err) {
            // For invalid JSON, set error and reset to default if it's clearly malformed
            const errorMessage =
              err instanceof Error ? err.message : "Invalid JSON";
            setJsonError(errorMessage);

            // Reset to default for clearly invalid JSON (not just incomplete typing)
            const trimmed = jsonString?.trim();
            if (trimmed && trimmed.length > 5 && !trimmed.match(/^[\s[{]/)) {
              onChange(generateDefaultValue(resolvedSchema));
            }
          }
        }, 300);
      },
      [onChange, setJsonError, resolvedSchema],
    );

    // Update rawJsonValue when value prop changes
    useEffect(() => {
      if (!isJsonMode) {
        setRawJsonValue(
          JSON.stringify(
            value ?? generateDefaultValue(resolvedSchema),
            null,
            2,
          ),
        );
      }
    }, [value, resolvedSchema, isJsonMode]);

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
          JSON.stringify(
            value ?? generateDefaultValue(resolvedSchema),
            null,
            2,
          ),
        );
        setIsJsonMode(true);
      }
    };

    const formatJson = () => {
      try {
        const jsonStr = rawJsonValue?.trim();
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

    const validateJson = () => {
      if (!isJsonMode) return { isValid: true, error: null };
      try {
        const jsonStr = rawJsonValue?.trim();
        if (!jsonStr) return { isValid: true, error: null };
        const parsed = JSON.parse(jsonStr);
        // Clear any pending debounced update and immediately update parent
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        onChange(parsed);
        setJsonError(undefined);
        return { isValid: true, error: null };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Invalid JSON";
        setJsonError(errorMessage);
        return { isValid: false, error: errorMessage };
      }
    };

    const handleCopyJson = useCallback(async () => {
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
    }, [toast, value]);

    useImperativeHandle(ref, () => ({
      validateJson,
      hasJsonError,
    }));

    const renderFormFields = (
      propSchema: JsonSchemaType,
      currentValue: JsonValue,
      path: string[] = [],
      depth: number = 0,
      parentSchema?: JsonSchemaType,
      propertyName?: string,
      variantDepth: number = 0,
    ) => {
      if (propSchema.allOf) {
        propSchema = mergeAllOf(propSchema, resolvedSchema);
      }

      const variants = getVariantOptions(propSchema);
      if (variants) {
        // variantDepth keeps directly nested selectors (a variant that is
        // itself a oneOf) from sharing one state slot at the same path
        const selectorKey = `${variantDepth}:${getPathKey(path)}`;
        const selectedIdx = Math.min(
          variantSelections[selectorKey] ??
            inferVariantIndex(variants, currentValue) ??
            0,
          variants.length - 1,
        );
        const resolveVariant = (idx: number): JsonSchemaType => {
          const variant = mergeAllOf(
            resolveRef(variants[idx] ?? {}, resolvedSchema),
            resolvedSchema,
          );
          // properties without an explicit type is a common object shorthand
          if (!variant.type && variant.properties) {
            return { ...variant, type: "object" };
          }
          return variant;
        };
        return (
          <div className="space-y-2">
            {propSchema.description && (
              <p className="text-sm text-gray-600">{propSchema.description}</p>
            )}
            <select
              value={selectedIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setVariantSelections((prev) => ({
                  ...prev,
                  [selectorKey]: idx,
                }));
                // Values from another variant rarely validate, so reset
                handleFieldChange(
                  path,
                  generateDefaultValue(
                    resolveVariant(idx),
                    propertyName,
                    parentSchema,
                  ),
                );
              }}
              aria-label={
                propertyName ? `Select ${propertyName} option` : "Select option"
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
            >
              {variants.map((option, idx) => (
                <option key={idx} value={idx}>
                  {option.title ?? `Option ${idx + 1}`}
                </option>
              ))}
            </select>
            {renderFormFields(
              resolveVariant(selectedIdx),
              currentValue,
              path,
              depth,
              parentSchema,
              propertyName,
              variantDepth + 1,
            )}
          </div>
        );
      }

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
                setJsonError(
                  err instanceof Error ? err.message : "Invalid JSON",
                );
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
          // Titled single-select using oneOf/anyOf with const/title pairs
          const titledOptions = (
            (propSchema.oneOf ?? propSchema.anyOf) as
              (JsonSchemaType | JsonSchemaConst)[] | undefined
          )?.filter((opt): opt is JsonSchemaConst => "const" in opt);

          if (titledOptions && titledOptions.length > 0) {
            return (
              <div className="space-y-2">
                {propSchema.description && (
                  <p className="text-sm text-gray-600">
                    {propSchema.description}
                  </p>
                )}
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
                  {titledOptions.map((option) => (
                    <option
                      key={String(option.const)}
                      value={String(option.const)}
                    >
                      {option.title ?? String(option.const)}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          // Untitled single-select using enum (with optional legacy enumNames for labels)
          if (propSchema.enum) {
            const names = Array.isArray(propSchema.enumNames)
              ? propSchema.enumNames
              : undefined;
            return (
              <div className="space-y-2">
                {propSchema.description && (
                  <p className="text-sm text-gray-600">
                    {propSchema.description}
                  </p>
                )}
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
                  {propSchema.enum.map((option, idx) => (
                    <option key={option} value={option}>
                      {names?.[idx] ?? option}
                    </option>
                  ))}
                </select>
              </div>
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
              value={getNumericDisplayValue(path, currentValue)}
              onChange={(e) => {
                const val = e.target.value;
                updateNumericDraft(path, val);
                if (!val && !isRequired) {
                  handleFieldChange(path, undefined);
                } else {
                  const num = Number(val);
                  if (!isNaN(num)) {
                    handleFieldChange(path, num);
                  }
                }
              }}
              onBlur={(e) => {
                const val = e.target.value;
                if (!val) {
                  clearNumericDraft(path);
                  return;
                }

                const num = Number(val);
                if (!isNaN(num)) {
                  handleFieldChange(path, num);
                }
                clearNumericDraft(path);
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
              value={getNumericDisplayValue(path, currentValue)}
              onChange={(e) => {
                const val = e.target.value;
                updateNumericDraft(path, val);
                if (!val && !isRequired) {
                  handleFieldChange(path, undefined);
                } else {
                  const num = Number(val);
                  if (!isNaN(num) && Number.isInteger(num)) {
                    handleFieldChange(path, num);
                  }
                }
              }}
              onBlur={(e) => {
                const val = e.target.value;
                if (!val) {
                  clearNumericDraft(path);
                  return;
                }

                const num = Number(val);
                if (!isNaN(num) && Number.isInteger(num)) {
                  handleFieldChange(path, num);
                }
                clearNumericDraft(path);
              }}
              placeholder={propSchema.description}
              required={isRequired}
              min={propSchema.minimum}
              max={propSchema.maximum}
            />
          );

        case "boolean":
          return (
            <div className="space-y-2">
              {propSchema.description && (
                <p className="text-sm text-gray-600">
                  {propSchema.description}
                </p>
              )}
              <Input
                type="checkbox"
                checked={(currentValue as boolean) ?? false}
                onChange={(e) => handleFieldChange(path, e.target.checked)}
                className="w-4 h-4"
                required={isRequired}
              />
            </div>
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
                    {(subSchema as JsonSchemaType).title ?? key}
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

          // Special handling: array of enums -> render multi-select control
          const itemSchema = propSchema.items as JsonSchemaType;
          let multiOptions: { value: string; label: string }[] | null = null;

          const titledMulti = (
            (itemSchema.anyOf ?? itemSchema.oneOf) as
              (JsonSchemaType | JsonSchemaConst)[] | undefined
          )?.filter((opt): opt is JsonSchemaConst => "const" in opt);

          if (titledMulti && titledMulti.length > 0) {
            multiOptions = titledMulti.map((o) => ({
              value: String(o.const),
              label: o.title ?? String(o.const),
            }));
          } else if (itemSchema.enum) {
            const names = Array.isArray(itemSchema.enumNames)
              ? itemSchema.enumNames
              : undefined;
            multiOptions = itemSchema.enum.map((v, i) => ({
              value: v,
              label: names?.[i] ?? v,
            }));
          }

          if (multiOptions) {
            const selectSize = Math.min(Math.max(multiOptions.length, 3), 8);
            return (
              <div className="space-y-2">
                {propSchema.description && (
                  <p className="text-sm text-gray-600">
                    {propSchema.description}
                  </p>
                )}
                <select
                  multiple
                  size={selectSize}
                  value={arrayValue as string[]}
                  onChange={(e) => {
                    const selected = Array.from(
                      (e.target as HTMLSelectElement).selectedOptions,
                    ).map((o) => o.value);
                    handleFieldChange(path, selected);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                >
                  {multiOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {(propSchema.minItems || propSchema.maxItems) && (
                  <p className="text-xs text-gray-500">
                    {propSchema.minItems
                      ? `Select at least ${propSchema.minItems}. `
                      : ""}
                    {propSchema.maxItems
                      ? `Select at most ${propSchema.maxItems}.`
                      : ""}
                  </p>
                )}
              </div>
            );
          }

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
      resolvedSchema.type === "object" &&
      (!resolvedSchema.properties ||
        Object.keys(resolvedSchema.properties).length === 0) &&
      !getVariantOptions(resolvedSchema);

    useEffect(() => {
      if (shouldUseJsonMode && !isJsonMode) {
        setIsJsonMode(true);
      }
    }, [shouldUseJsonMode, isJsonMode]);

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
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchToFormMode}
            >
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
            placeholder={resolvedSchema.description}
          />
        ) : // If schema type is object but value is not an object or is empty, and we have actual JSON data,
        // render a simple representation of the JSON data
        resolvedSchema.type === "object" &&
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
          renderFormFields(resolvedSchema, value)
        )}
      </div>
    );
  },
);

export default DynamicJsonForm;
