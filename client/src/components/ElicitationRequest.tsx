import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import DynamicJsonForm from "./DynamicJsonForm";
import JsonView from "./JsonView";
import { JsonSchemaType, JsonValue } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import {
  PendingElicitationRequest,
  ElicitationResponse,
  ElicitationFormRequestData,
} from "./ElicitationTab";
import Ajv from "ajv";

export type ElicitationRequestProps = {
  request: PendingElicitationRequest;
  onResolve: (id: number, response: ElicitationResponse) => void;
};

const ElicitationRequest = ({
  request,
  onResolve,
}: ElicitationRequestProps) => {
  const [formData, setFormData] = useState<JsonValue>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  const requestData = request.request;
  const isUrlMode = requestData.mode === "url";

  useEffect(() => {
    if (isUrlMode) return;
    const defaultValue = generateDefaultValue(
      (requestData as ElicitationFormRequestData).requestedSchema,
    );
    setFormData(defaultValue);
    setValidationError(null);
  }, [isUrlMode, requestData]);

  if (isUrlMode) {
    const handleOpenUrl = () => {
      window.open(requestData.url, "_blank", "noopener,noreferrer");
      onResolve(request.id, { action: "accept" });
    };

    return (
      <div
        data-testid="elicitation-request"
        className="flex flex-col gap-4 p-4 border rounded-lg"
      >
        <div className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded">
          <div className="space-y-2">
            <h4 className="font-semibold">URL Request</h4>
            <p className="text-sm">{requestData.message}</p>
            <a
              href={requestData.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 underline break-all"
            >
              {requestData.url}
            </a>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button type="button" onClick={handleOpenUrl}>
            Open URL
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onResolve(request.id, { action: "decline" })}
          >
            Decline
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onResolve(request.id, { action: "cancel" })}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // After URL-mode early return, requestData is guaranteed to be form mode
  const formRequest = requestData as ElicitationFormRequestData;

  const validateEmailFormat = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateFormData = (
    data: JsonValue,
    schema: JsonSchemaType,
  ): boolean => {
    if (
      schema.type === "object" &&
      schema.properties &&
      typeof data === "object" &&
      data !== null
    ) {
      const dataObj = data as Record<string, unknown>;

      if (Array.isArray(schema.required)) {
        for (const field of schema.required) {
          const value = dataObj[field];
          if (value === undefined || value === null || value === "") {
            setValidationError(`Required field missing: ${field}`);
            return false;
          }
        }
      }

      for (const [fieldName, fieldValue] of Object.entries(dataObj)) {
        const fieldSchema = schema.properties[fieldName];
        if (
          fieldSchema &&
          fieldSchema.format === "email" &&
          typeof fieldValue === "string"
        ) {
          if (!validateEmailFormat(fieldValue)) {
            setValidationError(`Invalid email format: ${fieldName}`);
            return false;
          }
        }
      }
    }

    return true;
  };

  const handleAccept = () => {
    try {
      if (!validateFormData(formData, formRequest.requestedSchema)) {
        return;
      }

      const ajv = new Ajv();
      const validate = ajv.compile(formRequest.requestedSchema);
      const isValid = validate(formData);

      if (!isValid) {
        const errorMessage = ajv.errorsText(validate.errors);
        setValidationError(errorMessage);
        return;
      }

      onResolve(request.id, {
        action: "accept",
        content: formData as Record<string, unknown>,
      });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Validation failed",
      );
    }
  };

  const handleDecline = () => {
    onResolve(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    onResolve(request.id, { action: "cancel" });
  };

  const schemaTitle =
    formRequest.requestedSchema.title || "Information Request";
  const schemaDescription = formRequest.requestedSchema.description;

  return (
    <div
      data-testid="elicitation-request"
      className="flex gap-4 p-4 border rounded-lg space-y-4"
    >
      <div className="flex-1 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded">
        <div className="space-y-2">
          <h4 className="font-semibold">{schemaTitle}</h4>
          <p className="text-sm">{formRequest.message}</p>
          {schemaDescription && (
            <p className="text-xs text-muted-foreground">{schemaDescription}</p>
          )}
          <div className="mt-2">
            <h5 className="text-xs font-medium mb-1">Request Schema:</h5>
            <JsonView
              data={JSON.stringify(formRequest.requestedSchema, null, 2)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4">
        <div className="space-y-2">
          <h4 className="font-medium">Response Form</h4>
          <DynamicJsonForm
            schema={formRequest.requestedSchema}
            value={formData}
            onChange={(newValue: JsonValue) => {
              setFormData(newValue);
              setValidationError(null);
            }}
          />

          {validationError && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="text-sm text-red-600 dark:text-red-400">
                <strong>Validation Error:</strong> {validationError}
              </div>
            </div>
          )}
        </div>

        <div className="flex space-x-2 mt-1">
          <Button type="button" onClick={handleAccept}>
            Submit
          </Button>
          <Button type="button" variant="outline" onClick={handleDecline}>
            Decline
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ElicitationRequest;
