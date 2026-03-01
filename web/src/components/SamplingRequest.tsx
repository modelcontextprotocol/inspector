import { Button } from "@/components/ui/button";
import JsonView from "./JsonView";
import { useMemo, useState } from "react";
import {
  CreateMessageResult,
  CreateMessageResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PendingRequest } from "./SamplingTab";
import DynamicJsonForm from "./DynamicJsonForm";
import { useToast } from "@/lib/hooks/useToast";
import { JsonSchemaType, JsonValue } from "@/utils/jsonUtils";

export type SamplingRequestProps = {
  request: PendingRequest;
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
};

const SamplingRequest = ({
  onApprove,
  request,
  onReject,
}: SamplingRequestProps) => {
  const { toast } = useToast();

  const [messageResult, setMessageResult] = useState<JsonValue>({
    model: "stub-model",
    stopReason: "endTurn",
    role: "assistant",
    content: {
      type: "text",
      text: "",
    },
  });

  const contentType = (
    (messageResult as { [key: string]: JsonValue })?.content as {
      [key: string]: JsonValue;
    }
  )?.type;

  const schema = useMemo(() => {
    const s: JsonSchemaType = {
      type: "object",
      description: "Message result",
      properties: {
        model: {
          type: "string",
          default: "stub-model",
          description: "model name",
        },
        stopReason: {
          type: "string",
          default: "endTurn",
          description: "Stop reason",
        },
        role: {
          type: "string",
          default: "assistant",
          description: "Role of the model",
        },
        content: {
          type: "object",
          properties: {
            type: {
              type: "string",
              default: "text",
              description: "Type of content",
            },
          },
        },
      },
    };

    if (contentType === "text" && s.properties) {
      s.properties.content.properties = {
        ...s.properties.content.properties,
        text: {
          type: "string",
          default: "",
          description: "text content",
        },
      };
      setMessageResult((prev) => ({
        ...(prev as { [key: string]: JsonValue }),
        content: {
          type: contentType,
          text: "",
        },
      }));
    } else if (contentType === "image" && s.properties) {
      s.properties.content.properties = {
        ...s.properties.content.properties,
        data: {
          type: "string",
          default: "",
          description: "Base64 encoded image data",
        },
        mimeType: {
          type: "string",
          default: "",
          description: "Mime type of the image",
        },
      };
      setMessageResult((prev) => ({
        ...(prev as { [key: string]: JsonValue }),
        content: {
          type: contentType,
          data: "",
          mimeType: "",
        },
      }));
    }

    return s;
  }, [contentType]);

  const handleApprove = (id: number) => {
    const validationResult = CreateMessageResultSchema.safeParse(messageResult);
    if (!validationResult.success) {
      toast({
        title: "Error",
        description: `There was an error validating the message result: ${validationResult.error.message}`,
        variant: "destructive",
      });
      return;
    }

    onApprove(id, validationResult.data);
  };

  return (
    <div
      data-testid="sampling-request"
      className="flex gap-4 p-4 border rounded-lg space-y-4"
    >
      <div className="flex-1 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded">
        <JsonView data={JSON.stringify(request.request)} />
      </div>
      <form className="flex-1 space-y-4">
        <div className="space-y-2">
          <DynamicJsonForm
            schema={schema}
            value={messageResult}
            onChange={(newValue: JsonValue) => {
              setMessageResult(newValue);
            }}
          />
        </div>
        <div className="flex space-x-2 mt-1">
          <Button type="button" onClick={() => handleApprove(request.id)}>
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onReject(request.id)}
          >
            Reject
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SamplingRequest;
