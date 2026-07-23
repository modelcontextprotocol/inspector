import {
  Checkbox,
  JsonInput,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { InspectorFormSchema } from "../../../utils/jsonUtils";

const FieldLabel = Text.withProps({
  fw: 500,
  size: "sm",
});

const FieldDescription = Text.withProps({
  size: "xs",
  c: "dimmed",
});

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Pair enum values with their non-standard `enumNames` titles into Mantine
 * `{ value, label }[]` option data. Falls back to bare enum values when
 * `enumNames` is absent or its length does not match `enum`, since a wrong-length
 * zip would mislabel options — worse than showing the raw values.
 */
function toEnumData(
  values: string[],
  names: string[] | undefined,
): string[] | { value: string; label: string }[] {
  if (names && names.length === values.length) {
    return values.map((value, index) => ({ value, label: names[index] }));
  }
  return values;
}

export interface SchemaFormProps {
  schema: InspectorFormSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

function getDefaultValue(fieldSchema: InspectorFormSchema): unknown {
  if (fieldSchema.default !== undefined) {
    return fieldSchema.default;
  }
  return undefined;
}

function resolveValue(
  value: unknown,
  fieldSchema: InspectorFormSchema,
): unknown {
  if (value !== undefined) {
    return value;
  }
  return getDefaultValue(fieldSchema);
}

export function SchemaForm({
  schema,
  values,
  onChange,
  disabled = false,
}: SchemaFormProps) {
  const properties = schema.properties ?? {};
  const requiredFields = schema.required ?? [];

  function handleFieldChange(fieldName: string, fieldValue: unknown) {
    onChange({ ...values, [fieldName]: fieldValue });
  }

  function renderField(fieldName: string, fieldSchema: InspectorFormSchema) {
    const isRequired = requiredFields.includes(fieldName);
    const label = fieldSchema.title ?? fieldName;
    const description = fieldSchema.description;
    const rawValue = resolveValue(values[fieldName], fieldSchema);

    // string with enum
    if (fieldSchema.type === "string" && fieldSchema.enum) {
      return (
        <Select
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          data={toEnumData(fieldSchema.enum, fieldSchema.enumNames)}
          value={(rawValue as string) ?? null}
          onChange={(val) => handleFieldChange(fieldName, val)}
        />
      );
    }

    // string with oneOf
    if (fieldSchema.type === "string" && fieldSchema.oneOf) {
      const data = fieldSchema.oneOf.map((item) => ({
        value: String(item.const ?? ""),
        label: item.title ?? String(item.const ?? ""),
      }));
      return (
        <Select
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          data={data}
          value={(rawValue as string) ?? null}
          onChange={(val) => handleFieldChange(fieldName, val)}
        />
      );
    }

    // plain string
    if (fieldSchema.type === "string") {
      return (
        <TextInput
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          value={(rawValue as string) ?? ""}
          minLength={fieldSchema.minLength}
          maxLength={fieldSchema.maxLength}
          onChange={(event) =>
            handleFieldChange(fieldName, event.currentTarget.value)
          }
          rightSectionPointerEvents="auto"
          rightSection={
            rawValue ? (
              <ClearButton onClick={() => handleFieldChange(fieldName, "")} />
            ) : null
          }
        />
      );
    }

    // number or integer
    if (fieldSchema.type === "number" || fieldSchema.type === "integer") {
      return (
        <NumberInput
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          value={(rawValue as number) ?? ""}
          min={fieldSchema.minimum}
          max={fieldSchema.maximum}
          onChange={(val) => {
            const numericValue = typeof val === "string" ? undefined : val;
            handleFieldChange(fieldName, numericValue);
          }}
        />
      );
    }

    // boolean
    if (fieldSchema.type === "boolean") {
      return (
        <Checkbox
          key={fieldName}
          label={label}
          description={description}
          disabled={disabled}
          checked={(rawValue as boolean) ?? false}
          onChange={(event) =>
            handleFieldChange(fieldName, event.currentTarget.checked)
          }
        />
      );
    }

    // array of enum values (multi-select)
    if (fieldSchema.type === "array" && fieldSchema.items?.enum) {
      const data = toEnumData(
        fieldSchema.items.enum,
        fieldSchema.items.enumNames,
      );
      return (
        <MultiSelect
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          data={data}
          value={(rawValue as string[]) ?? []}
          onChange={(val) => handleFieldChange(fieldName, val)}
        />
      );
    }

    // array with items having anyOf
    if (fieldSchema.type === "array" && fieldSchema.items?.anyOf) {
      const data = fieldSchema.items.anyOf.map((item) => ({
        value: String(item.const ?? ""),
        label: item.title ?? String(item.const ?? ""),
      }));
      return (
        <MultiSelect
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          data={data}
          value={(rawValue as string[]) ?? []}
          onChange={(val) => handleFieldChange(fieldName, val)}
        />
      );
    }

    // nested object
    if (fieldSchema.type === "object" && fieldSchema.properties) {
      return (
        <Stack key={fieldName} gap="sm">
          <FieldLabel>{label}</FieldLabel>
          {description && <FieldDescription>{description}</FieldDescription>}
          <Stack gap="sm" pl="md">
            <SchemaForm
              schema={fieldSchema}
              values={(rawValue as Record<string, unknown>) ?? {}}
              onChange={(nestedValues) =>
                handleFieldChange(fieldName, nestedValues)
              }
              disabled={disabled}
            />
          </Stack>
        </Stack>
      );
    }

    // fallback: JsonInput for complex schemas
    return (
      <JsonInput
        key={fieldName}
        label={label}
        description={description}
        withAsterisk={isRequired}
        disabled={disabled}
        formatOnBlur
        autosize
        value={rawValue !== undefined ? serializeJson(rawValue) : ""}
        onChange={(val) => {
          try {
            handleFieldChange(fieldName, JSON.parse(val));
          } catch {
            handleFieldChange(fieldName, val);
          }
        }}
      />
    );
  }

  return (
    <Stack gap="sm">
      {Object.entries(properties).map(([fieldName, fieldSchema]) =>
        renderField(fieldName, fieldSchema),
      )}
    </Stack>
  );
}
