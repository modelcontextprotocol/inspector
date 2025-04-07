import { Button } from "@/components/ui/button";
import JsonView from "./JsonView";
import { useMemo, useState } from "react";
import {
  CreateMessageResult,
  CreateMessageResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PendingRequest } from "./SamplingTab";
import DynamicJsonForm, { JsonSchemaType, JsonValue } from "./DynamicJsonForm";
import { useToast } from "@/hooks/use-toast";

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
    model: "GPT-4o",
    stopReason: "endTurn",
    role: "assistant",
    content: {
      type: "text",
      text: "",
    },
  });

  const s = useMemo(() => {
    const schema: JsonSchemaType = {
      type: "object",
      description: "Message result",
      properties: {
        model: {
          type: "string",
          default: "GPT-4o",
          description: "model name",
        },
        stopReason: {
          type: "string",
          default: "endTurn",
          description: "Stop reason",
        },
        role: {
          type: "string",
          default: "endTurn",
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

    const contentType = (messageResult as any)?.content?.type;
    if (contentType === "text" && schema.properties) {
      schema.properties.content.properties = {
        ...schema.properties.content.properties,
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
    } else if (contentType === "image" && schema.properties) {
      schema.properties.content.properties = {
        ...schema.properties.content.properties,
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

    return schema;
  }, [(messageResult as any)?.content?.type]);

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
            defaultIsJsonMode={true}
            schema={s}
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
