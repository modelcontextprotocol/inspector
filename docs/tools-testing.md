# Tool Testing Guide

This guide explains how different types of tool inputs are expected be handled in the MCP Inspector. (Note that this guide currently only covers testing using the UI and not CLI mode.)

The Tools UI provides both structured form and raw JSON editor modes. For supported types, the UI allows switching between modes while preserving values, with some exceptions for [complex objects](#complex-objects). Input types are validated in both modes.

## Input Type Handling

### Basic Types

| Type      | Example Schema          | Expected Input | Form Behavior            |
| --------- | ----------------------- | -------------- | ------------------------ |
| `integer` | `{ "type": "integer" }` | `42`           | Number input with step=1 |
| `number`  | `{ "type": "number" }`  | `42.5`         | Number input             |
| `string`  | `{ "type": "string" }`  | `"hello"`      | Text input               |
| `boolean` | `{ "type": "boolean" }` | `true`/`false` | Checkbox                 |
| `null`    | `{ "type": "null" }`    | `null`         | N/A                      |

### Type Conversion Rules

| Input Type       | Target Type | Conversion Behavior        | Example                  |
| ---------------- | ----------- | -------------------------- | ------------------------ |
| String → Integer | `integer`   | Reject if not whole number | "42" → 42, "1.5" → error |
| Number → Integer | `integer`   | Reject if not whole number | 42 → 42, 1.5 → error     |
| String → Number  | `number`    | Convert if valid number    | "42.5" → 42.5            |
| String → Boolean | `boolean`   | Only accept "true"/"false" | "true" → true            |

## Complex Objects

Complex objects include nested structures (objects within objects) and arrays. Their handling differs between form and JSON modes based on complexity.

### Array Handling

| Type           | Example Schema                                      | Expected Input                           | Form Behavior                              |
| -------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| Simple Array   | `{ "type": "array", "items": { "type": "string" }}` | `["item1", "item2"]`                     | Dynamic list with add/remove buttons       |
| Object Array   | `{ "type": "array", "items": { "type": "object" }}` | `[{"name": "item1"}, {"name": "item2"}]` | Dynamic form rows with nested fields       |
| Optional Array | `{ "type": ["array", "null"] }`                     | `[]` or omitted                          | Empty array or field omitted, never `null` |

### Nested Objects

| Structure    | Example Schema                                                   | Form Mode       | JSON Mode |
| ------------ | ---------------------------------------------------------------- | --------------- | --------- |
| Single Level | `{"type": "object", "properties": {"name": {"type": "string"}}}` | Structured form | Available |
| Multi Level  | `{"type": "object", "properties": {"user": {"type": "object"}}}` | JSON only       | Available |
| Mixed Types  | `{"type": "object", "properties": {"data": {"oneOf": [...]}}}`   | JSON only       | Available |

### Optional Fields in Complex Types

| Scenario                  | Example                        | Expected Behavior                 |
| ------------------------- | ------------------------------ | --------------------------------- |
| Optional field (any type) | `{"required": false}`          | Omit field entirely from request  |
| Nullable field            | `{"type": ["string", "null"]}` | May explicitly set to `null`      |
| Empty array (when set)    | `{"type": "array"}`            | Send `[]` if explicitly set empty |
| Empty object (when set)   | `{"type": "object"}`           | Send `{}` if explicitly set empty |

## Testing Scenarios and Expected Results for Complex Objects

| Test Case                  | Description                                 | Expected Behavior                                        |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Complex nested form fields | Tool with multiple levels of nested objects | Only JSON mode is available                              |
| Array field manipulation   | Add/remove items in array                   | Form mode allows for items to be added and removed       |
| Optional nested fields     | Object with optional nested properties      | Field omitted entirely when not set                      |
| Mixed type arrays          | Array accepting multiple types              | Only JSON mode is available                              |
| Nullable vs Optional       | Field allowing null vs optional field       | Null explicitly set vs field omitted                     |
| Empty collections          | Empty arrays or objects                     | Send `[]` or `{}` only if explicitly set, otherwise omit |

## Optional Parameters

**When an optional parameter is not set by the user:**

- The parameter will be completely omitted from the request
- Example: If `name` is optional and unset: `{}` will be sent in the request.

**When an optional parameter explicitly accepts null:**

- Schema must declare null as valid: `{ "type": ["string", "null"] }`
- Only then will null be sent: `{ "name": null }`

**When an optional string is set to empty:**

- Empty string will be sent, eg: `{ "name": "" }`
