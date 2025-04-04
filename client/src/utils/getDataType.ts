import { JsonValue } from "../components/DynamicJsonForm";

const typeofVariable = typeof "random variable";

const getDataType = (
  value: JsonValue,
): typeof typeofVariable | "array" | "null" => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

export default getDataType;
