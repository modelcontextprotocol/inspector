import AjvLib from "ajv";
import * as addFormats from "ajv-formats";

// JSON Schema for validating eval configuration files
export const evalConfigSchema = {
  type: "object",
  properties: {
    config: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "Claude model to use for evaluation",
          default: "claude-3-haiku-20240307",
        },
        timeout: {
          type: "number",
          minimum: 1000,
          maximum: 300000,
          description: "Timeout in milliseconds",
          default: 30000,
        },
        maxSteps: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of LLM steps",
          default: 3,
        },
      },
      additionalProperties: false,
    },
    evals: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            minLength: 1,
            pattern: "^[a-zA-Z0-9_-]+$",
            description: "Unique identifier for this eval",
          },
          description: {
            type: "string",
            description: "Human-readable description of what this eval tests",
          },
          prompt: {
            type: "string",
            minLength: 1,
            description: "The prompt/question to send to the LLM",
          },
          expectedToolCalls: {
            type: "object",
            properties: {
              required: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
                description: "Tools that must be called",
              },
              allowed: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
                description:
                  "Tools that may be called (in addition to required)",
              },
              prohibited: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
                description: "Tools that must not be called",
              },
            },
            additionalProperties: false,
            description: "Tool call expectations",
          },
          responseScorers: {
            type: "array",
            minItems: 1,
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    type: { const: "json-schema" },
                    schema: {
                      type: "object",
                      description: "JSON Schema for validating the response",
                    },
                  },
                  required: ["type", "schema"],
                  additionalProperties: false,
                  description: "JSON Schema scorer",
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "regex" },
                    pattern: {
                      type: "string",
                      description: "Regex pattern to match in the response",
                    },
                  },
                  required: ["type", "pattern"],
                  additionalProperties: false,
                  description: "Regex pattern scorer",
                },
                {
                  type: "object",
                  properties: {
                    type: { const: "llm-judge" },
                    criteria: {
                      type: "string",
                      description: "Evaluation criteria for the LLM judge",
                    },
                    threshold: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description: "Minimum score threshold (0.0 to 1.0)",
                      default: 0.8,
                    },
                  },
                  required: ["type", "criteria"],
                  additionalProperties: false,
                  description: "LLM judge scorer",
                },
              ],
            },
            description: "Array of scorers to validate the LLM response",
          },
        },
        required: ["name", "prompt", "responseScorers"],
        additionalProperties: false,
      },
    },
  },
  required: ["evals"],
  additionalProperties: false,
} as const;

export interface EvalConfig {
  config?: {
    model?: string;
    timeout?: number;
    maxSteps?: number;
  };
  evals: Array<{
    name: string;
    description?: string;
    prompt: string;
    expectedToolCalls?: {
      required?: string[];
      allowed?: string[];
      prohibited?: string[];
    };
    responseScorers: Array<{
      type: "json-schema" | "llm-judge" | "regex";
      schema?: any;
      pattern?: string;
      criteria?: string;
      threshold?: number;
    }>;
  }>;
}

export function validateEvalConfig(config: unknown): {
  valid: boolean;
  errors?: string[];
} {
  const Ajv = AjvLib.default || AjvLib;
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
  });

  // Add format validation
  (addFormats as any).default(ajv);

  const validate = ajv.compile(evalConfigSchema);
  const valid = validate(config);

  if (!valid) {
    const errors = validate.errors?.map((error: any) => {
      const path = error.instancePath
        ? error.instancePath.replace(/\//g, ".").substring(1)
        : "root";
      const message = error.message || "validation failed";

      let actualText = "";
      if (error.data !== undefined) {
        const actualValue =
          typeof error.data === "string"
            ? error.data
            : JSON.stringify(error.data);
        actualText = ` (got: ${actualValue})`;
      }

      return `${path}: ${message}${actualText}`;
    }) || ["Unknown validation error"];

    return { valid: false, errors };
  }

  // Additional semantic validation
  const semanticErrors: string[] = [];
  const evalConfig = config as EvalConfig;

  // Check for duplicate eval names
  const names = evalConfig.evals.map((e) => e.name);
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index,
  );
  if (duplicates.length > 0) {
    semanticErrors.push(`Duplicate eval names: ${duplicates.join(", ")}`);
  }

  // Validate JSON schemas in responseScorers
  for (const [evalIndex, evalItem] of evalConfig.evals.entries()) {
    for (const [scorerIndex, scorer] of evalItem.responseScorers.entries()) {
      if (scorer.type === "json-schema" && scorer.schema) {
        try {
          ajv.compile(scorer.schema);
        } catch (error: any) {
          semanticErrors.push(
            `evals[${evalIndex}].responseScorers[${scorerIndex}].schema: Invalid JSON Schema - ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      if (scorer.type === "regex" && scorer.pattern) {
        try {
          new RegExp(scorer.pattern);
        } catch (error: any) {
          semanticErrors.push(
            `evals[${evalIndex}].outputScorers[${scorerIndex}].pattern: Invalid regex - ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    }
  }

  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors };
  }

  return { valid: true };
}
