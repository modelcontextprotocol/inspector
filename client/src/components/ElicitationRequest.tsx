import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import DynamicJsonForm from "./DynamicJsonForm";
import JsonView from "./JsonView";
import { JsonSchemaType, JsonValue } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import {
  PendingElicitationRequest,
  ElicitationResponse,
} from "./ElicitationTab";
import Ajv from "ajv";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink } from "lucide-react";

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

  const requestedSchema =
    request.request.mode === "form"
      ? request.request.requestedSchema
      : undefined;

  useEffect(() => {
    if (requestedSchema) {
      const defaultValue = generateDefaultValue(requestedSchema);
      setFormData(defaultValue);
      setValidationError(null);
    }
  }, [requestedSchema]);

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

  const validateUrl = (url: string): boolean => {
    try {
      const parsedUrl = new URL(url);
      // Only allow HTTPS URLs for security
      if (parsedUrl.protocol !== "https:") {
        setValidationError("Only HTTPS URLs are allowed for security reasons");
        return false;
      }
      return true;
    } catch {
      setValidationError("Invalid URL format");
      return false;
    }
  };

  const handleAccept = () => {
    if (request.request.mode === "url") {
      // For URL mode, just accept and let the browser handle the URL
      onResolve(request.id, { action: "accept" });
    } else if (
      request.request.mode === "form" &&
      request.request.requestedSchema
    ) {
      // For form mode, validate and submit the form data
      try {
        if (!validateFormData(formData, request.request.requestedSchema)) {
          return;
        }

        const ajv = new Ajv();
        const validate = ajv.compile(request.request.requestedSchema);
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
    }
  };

  const handleOpenUrl = () => {
    if (request.request.mode === "url" && request.request.url) {
      if (validateUrl(request.request.url)) {
        window.open(request.request.url, "_blank", "noopener,noreferrer");
      }
    }
  };

  const handleDecline = () => {
    onResolve(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    onResolve(request.id, { action: "cancel" });
  };

  // Render URL mode elicitation
  if (request.request.mode === "url") {
    return (
      <div
        data-testid="elicitation-request"
        className="flex gap-4 p-4 border rounded-lg"
      >
        <div className="flex-1 space-y-4">
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">URL Elicitation Request</p>
                <p className="text-sm">{request.request.message}</p>
                {request.request.url && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs">
                      <span className="font-medium">Target Domain: </span>
                      <code className="bg-muted px-1 rounded">
                        {(() => {
                          try {
                            return new URL(request.request.url!).host;
                          } catch {
                            return request.request.url;
                          }
                        })()}
                      </code>
                    </p>
                    <p className="text-xs">
                      <span className="font-medium">URL: </span>
                      <span className="break-all text-muted-foreground">
                        {request.request.url}
                      </span>
                    </p>
                  </div>
                )}
                {request.request.elicitationId && (
                  <p className="text-xs">
                    <span className="font-medium">Elicitation ID: </span>
                    <span className="text-muted-foreground">
                      {request.request.elicitationId}
                    </span>
                  </p>
                )}
              </div>
            </AlertDescription>
          </Alert>

          <div className="flex space-x-2">
            <Button type="button" onClick={handleOpenUrl}>
              Open URL
            </Button>
            <Button type="button" onClick={handleAccept}>
              Accept
            </Button>
            <Button type="button" variant="outline" onClick={handleDecline}>
              Decline
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>

          {validationError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="text-sm text-red-600 dark:text-red-400">
                <strong>Error:</strong> {validationError}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render form mode elicitation (existing implementation)
  const schemaTitle =
    request.request.requestedSchema?.title || "Information Request";
  const schemaDescription = request.request.requestedSchema?.description;

  return (
    <div
      data-testid="elicitation-request"
      className="flex gap-4 p-4 border rounded-lg space-y-4"
    >
      <div className="flex-1 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded">
        <div className="space-y-2">
          <h4 className="font-semibold">{schemaTitle}</h4>
          <p className="text-sm">{request.request.message}</p>
          {schemaDescription && (
            <p className="text-xs text-muted-foreground">{schemaDescription}</p>
          )}
          {request.request.requestedSchema && (
            <div className="mt-2">
              <h5 className="text-xs font-medium mb-1">Request Schema:</h5>
              <JsonView
                data={JSON.stringify(request.request.requestedSchema, null, 2)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4">
        <div className="space-y-2">
          <h4 className="font-medium">Response Form</h4>
          {request.request.requestedSchema && (
            <DynamicJsonForm
              schema={request.request.requestedSchema}
              value={formData}
              onChange={(newValue: JsonValue) => {
                setFormData(newValue);
                setValidationError(null);
              }}
            />
          )}

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
