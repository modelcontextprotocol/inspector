import { JsonValue } from "../components/DynamicJsonForm";

export type JsonObject = { [key: string]: JsonValue };

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
  value: JsonValue
): JsonValue {
  if (path.length === 0) return value;

  // Initialize if null/undefined
  if (obj === null || obj === undefined) {
    obj = !isNaN(Number(path[0])) ? [] : {};
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return updateArray(obj, path, value);
  } 
  // Handle objects
  else if (typeof obj === "object" && obj !== null) {
    return updateObject(obj as JsonObject, path, value);
  } 
  // Cannot update primitives
  else {
    console.error(
      `Cannot update path ${path.join(".")} in non-object/array value:`,
      obj
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
  value: JsonValue
): JsonValue[] {
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

  // Create a dense copy of the array, filling holes with null
  let newArray: JsonValue[] = [];
  for (let i = 0; i < array.length; i++) {
    newArray[i] = i in array ? array[i] : null;
  }

  // If the desired index is out of bounds, build a new array explicitly filled with nulls
  if (arrayIndex >= newArray.length) {
    console.warn(`Extending array to index ${arrayIndex}`);
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
    newArray[arrayIndex] = updateValueAtPath(newArray[arrayIndex], restPath, value);
  }
  return newArray;
}

/**
 * Updates an object at a specific path
 */
function updateObject(
  obj: JsonObject, 
  path: string[], 
  value: JsonValue
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
  defaultValue: JsonValue = null
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
