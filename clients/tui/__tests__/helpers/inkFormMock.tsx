import React from "react";
import { Box, Text, useInput } from "ink";

/**
 * Test double for `ink-form`.
 *
 * The real Form runs an interactive multi-field terminal widget that is hard
 * to drive field-by-field under ink-testing-library. The modals only care
 * that `onSubmit` eventually fires with a values object; the success / error
 * / throw outcome is decided by the `inspectorClient` fake the test injects,
 * not by the field values. So this double renders a marker plus the form
 * title and invokes `onSubmit` when the user presses Enter ("\r").
 *
 * The submitted value defaults to `{}`; pass a different payload from a test
 * by setting `globalThis.__INK_FORM_SUBMIT_VALUE__` before pressing Enter.
 *
 * Usage in a test file:
 *   vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));
 */
interface MockFormProps {
  form?: { title?: string };
  onSubmit?: (value: object) => void;
}

export function Form({ form, onSubmit }: MockFormProps) {
  useInput((_input, key) => {
    if (key.return) {
      const value =
        (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ ?? {};
      onSubmit?.(value as object);
    }
  });
  return (
    <Box flexDirection="column">
      <Text>MOCK_FORM:{form?.title ?? ""}</Text>
    </Box>
  );
}
