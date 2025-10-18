export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchemaConst = {
  const: JsonValue;
  title?: string;
  description?: string;
};

export type JsonSchemaType = {
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null"
    | (
        | "string"
        | "number"
        | "integer"
        | "boolean"
        | "array"
        | "object"
        | "null"
      )[];
  title?: string;
  description?: string;
  required?: string[];
  default?: JsonValue;
  properties?: Record<string, JsonSchemaType>;
  items?: JsonSchemaType;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  nullable?: boolean;
  pattern?: string;
  format?: string;
  enum?: string[];
  const?: JsonValue;
  oneOf?: (JsonSchemaType | JsonSchemaConst)[];
  anyOf?: (JsonSchemaType | JsonSchemaConst)[];
};

export type JsonObject = { [key: string]: JsonValue };

export type DataType =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "symbol"
  | "undefined"
  | "object"
  | "function"
  | "array"
  | "null";

/**
 * Determines the specific data type of a JSON value
 * @param value The JSON value to analyze
 * @returns The specific data type including "array" and "null" as distinct types
 */
export function getDataType(value: JsonValue): DataType {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Attempts to parse a string as JSON, only for objects and arrays
 * @param str The string to parse
 * @returns Object with success boolean and either parsed data or original string
 */
export function tryParseJson(str: string): {
  success: boolean;
  data: JsonValue;
} {
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

/**
 * Updates a value at a specific path in a nested JSON structure
 * @param obj The original JSON value
 * @param path Array of keys/indices representing the path to the value
 * @param value The new value to set
 * @returns A new JSON value with the updated path
 */
export function updateValueAtPath(
  obj: JsonValue,
  path: string[],
  value: JsonValue,
): JsonValue {
  if (path.length === 0) return value;

  if (obj === null || obj === undefined) {
    obj = !isNaN(Number(path[0])) ? [] : {};
  }

  if (Array.isArray(obj)) {
    return updateArray(obj, path, value);
  } else if (typeof obj === "object" && obj !== null) {
    return updateObject(obj as JsonObject, path, value);
  } else {
    console.error(
      `Cannot update path ${path.join(".")} in non-object/array value:`,
      obj,
    );
    return obj;
  }
}

/**
 * Updates an array at a specific path
 */
function updateArray(
  array: JsonValue[],
  path: string[],
  value: JsonValue,
): JsonValue[] {
  const [index, ...restPath] = path;
  const arrayIndex = Number(index);

  if (isNaN(arrayIndex)) {
    console.error(`Invalid array index: ${index}`);
    return array;
  }

  if (arrayIndex < 0) {
    console.error(`Array index out of bounds: ${arrayIndex} < 0`);
    return array;
  }

  let newArray: JsonValue[] = [];
  for (let i = 0; i < array.length; i++) {
    newArray[i] = i in array ? array[i] : null;
  }

  if (arrayIndex >= newArray.length) {
    const extendedArray: JsonValue[] = new Array(arrayIndex).fill(null);
    // Copy over the existing elements (now guaranteed to be dense)
    for (let i = 0; i < newArray.length; i++) {
      extendedArray[i] = newArray[i];
    }
    newArray = extendedArray;
  }

  if (restPath.length === 0) {
    newArray[arrayIndex] = value;
  } else {
    newArray[arrayIndex] = updateValueAtPath(
      newArray[arrayIndex],
      restPath,
      value,
    );
  }
  return newArray;
}

/**
 * Updates an object at a specific path
 */
function updateObject(
  obj: JsonObject,
  path: string[],
  value: JsonValue,
): JsonObject {
  const [key, ...restPath] = path;

  // Validate object key
  if (typeof key !== "string") {
    console.error(`Invalid object key: ${key}`);
    return obj;
  }

  const newObj = { ...obj };

  if (restPath.length === 0) {
    newObj[key] = value;
  } else {
    // Ensure key exists
    if (!(key in newObj)) {
      newObj[key] = {};
    }
    newObj[key] = updateValueAtPath(newObj[key], restPath, value);
  }
  return newObj;
}

/**
 * Gets a value at a specific path in a nested JSON structure
 * @param obj The JSON value to traverse
 * @param path Array of keys/indices representing the path to the value
 * @param defaultValue Value to return if path doesn't exist
 * @returns The value at the path, or defaultValue if not found
 */
export function getValueAtPath(
  obj: JsonValue,
  path: string[],
  defaultValue: JsonValue = null,
): JsonValue {
  if (path.length === 0) return obj;

  const [first, ...rest] = path;

  if (obj === null || obj === undefined) {
    return defaultValue;
  }

  if (Array.isArray(obj)) {
    const index = Number(first);
    if (isNaN(index) || index < 0 || index >= obj.length) {
      return defaultValue;
    }
    return getValueAtPath(obj[index], rest, defaultValue);
  }

  if (typeof obj === "object" && obj !== null) {
    if (!(first in obj)) {
      return defaultValue;
    }
    return getValueAtPath((obj as JsonObject)[first], rest, defaultValue);
  }

  return defaultValue;
}
