/**
 * Converts URI Template to ink-form format for resource templates
 */

import type { FormStructure, FormSection, FormField } from "ink-form";
import { UriTemplate } from "@modelcontextprotocol/client";
import {
  requiredGroups,
  templateVariables,
} from "@inspector/core/mcp/uriTemplate.js";

/**
 * Converts a URI Template to ink-form structure.
 *
 * Fields come from core's `templateVariables`, the same parser
 * `InspectorClient.readResourceFromTemplate` expands through, so the key this
 * form submits is the key the expander looks up. Using the SDK's
 * `variableNames` here instead is not merely untidy -- it mangles the name:
 * `{;id}` yields `";id"` and `{id:3}` yields `"id:3"`, so the form would submit
 * `{ ";id": "7" }` while the expander looks for `id`, silently dropping the
 * value and the whole expression with it (#1919).
 *
 * The SDK template is still constructed, but only to validate: core's parser is
 * deliberately lenient (an unclosed `{` becomes literal text), so this is what
 * still surfaces a malformed template as an empty form plus a logged error.
 */
export function uriTemplateToForm(
  uriTemplate: string,
  templateName: string,
): FormStructure {
  let fields: FormField[] = [];

  try {
    new UriTemplate(uriTemplate);
    // Only a variable that is the *sole* member of a non-omittable expression
    // is genuinely mandatory. RFC 6570 drops undefined names from a multi-name
    // expression, so `{a,b}` needs only one of the two -- ink-form cannot
    // express "any one of these", and marking both required would refuse input
    // the expander accepts.
    const mandatory = new Set(
      requiredGroups(uriTemplate)
        .filter((names) => names.length === 1)
        .map(([name]) => name),
    );
    fields = templateVariables(uriTemplate).map(({ name }) => ({
      name,
      label: name,
      type: "string",
      required: mandatory.has(name),
    }));
  } catch (error) {
    // If parsing fails, return empty form
    console.error("Failed to parse URI template:", error);
  }

  const sections: FormSection[] = [
    {
      title: "Template Variables",
      fields,
    },
  ];

  return {
    title: `Read Resource: ${templateName}`,
    sections,
  };
}
