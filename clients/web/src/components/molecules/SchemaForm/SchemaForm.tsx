import {
  Checkbox,
  JsonInput,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  oneOf?: Array<{ const: string; title?: string }>;
  anyOf?: Array<{ const: string; title?: string }>;
  default?: unknown;
  description?: string;
  title?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
}

export interface SchemaFormProps {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

function getDefaultValue(fieldSchema: JsonSchema): unknown {
  if (fieldSchema.default !== undefined) {
    return fieldSchema.default;
  }
  return undefined;
}

function resolveValue(value: unknown, fieldSchema: JsonSchema): unknown {
  if (value !== undefined) {
    return value;
  }
  return getDefaultValue(fieldSchema);
}

export function SchemaForm({ schema, values, onChange, disabled = false }: SchemaFormProps) {
  const properties = schema.properties ?? {};
  const requiredFields = schema.required ?? [];

  function handleFieldChange(fieldName: string, fieldValue: unknown) {
    onChange({ ...values, [fieldName]: fieldValue });
  }

  function renderField(fieldName: string, fieldSchema: JsonSchema) {
    const isRequired = requiredFields.includes(fieldName);
    const label = fieldSchema.title ?? fieldName;
    const description = fieldSchema.description;
    const rawValue = resolveValue(values[fieldName], fieldSchema);

    // string with enum
    if (fieldSchema.type === 'string' && fieldSchema.enum) {
      return (
        <Select
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          data={fieldSchema.enum}
          value={(rawValue as string) ?? null}
          onChange={(val) => handleFieldChange(fieldName, val)}
        />
      );
    }

    // string with oneOf
    if (fieldSchema.type === 'string' && fieldSchema.oneOf) {
      const data = fieldSchema.oneOf.map((item) => ({
        value: item.const,
        label: item.title ?? item.const,
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
    if (fieldSchema.type === 'string') {
      return (
        <TextInput
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          value={(rawValue as string) ?? ''}
          minLength={fieldSchema.minLength}
          maxLength={fieldSchema.maxLength}
          onChange={(event) => handleFieldChange(fieldName, event.currentTarget.value)}
        />
      );
    }

    // number or integer
    if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
      return (
        <NumberInput
          key={fieldName}
          label={label}
          description={description}
          withAsterisk={isRequired}
          disabled={disabled}
          value={(rawValue as number) ?? ''}
          min={fieldSchema.minimum}
          max={fieldSchema.maximum}
          onChange={(val) => {
            const numericValue = typeof val === 'string' ? undefined : val;
            handleFieldChange(fieldName, numericValue);
          }}
        />
      );
    }

    // boolean
    if (fieldSchema.type === 'boolean') {
      return (
        <Checkbox
          key={fieldName}
          label={label}
          description={description}
          disabled={disabled}
          checked={(rawValue as boolean) ?? false}
          onChange={(event) => handleFieldChange(fieldName, event.currentTarget.checked)}
        />
      );
    }

    // array with items having anyOf
    if (fieldSchema.type === 'array' && fieldSchema.items?.anyOf) {
      const data = fieldSchema.items.anyOf.map((item) => ({
        value: item.const,
        label: item.title ?? item.const,
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
    if (fieldSchema.type === 'object' && fieldSchema.properties) {
      return (
        <Stack key={fieldName} gap="sm">
          <Text fw={500} size="sm">
            {label}
          </Text>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
          <Stack gap="sm" pl="md">
            <SchemaForm
              schema={fieldSchema}
              values={(rawValue as Record<string, unknown>) ?? {}}
              onChange={(nestedValues) => handleFieldChange(fieldName, nestedValues)}
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
        value={rawValue !== undefined ? JSON.stringify(rawValue, null, 2) : ''}
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
