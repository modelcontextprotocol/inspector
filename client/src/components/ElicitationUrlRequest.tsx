import {
  ElicitationResponse,
  PendingElicitationRequest,
  UrlElicitationRequestData,
} from "@/components/ElicitationTab.tsx";
import JsonView from "@/components/JsonView.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CheckCheck, Copy } from "lucide-react";
import useCopy from "@/lib/hooks/useCopy.ts";
import { toast } from "@/lib/hooks/useToast.ts";

export type ElicitationUrlRequestProps = {
  request: PendingElicitationRequest & {
    request: UrlElicitationRequestData;
  };
  onResolve: (id: number, response: ElicitationResponse) => void;
};

const ElicitationUrlRequest = ({
  request,
  onResolve,
}: ElicitationUrlRequestProps) => {
  const { copied, setCopied } = useCopy();

  const parsedUrl = (() => {
    try {
      return new URL(request.request.url);
    } catch {
      return null;
    }
  })();

  const handleAcceptAndOpen = () => {
    if (!parsedUrl) {
      return;
    }

    window.open(parsedUrl.href, "_blank", "noopener,noreferrer");

    onResolve(request.id, {
      action: "accept",
    });
  };

  const handleAccept = () => {
    onResolve(request.id, {
      action: "accept",
    });
  };

  const handleDecline = () => {
    onResolve(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    onResolve(request.id, { action: "cancel" });
  };

  const warnings = (() => {
    if (!parsedUrl) {
      return [];
    }

    const warnings: string[] = [];

    if (parsedUrl.protocol !== "https:") {
      warnings.push("Not HTTPS protocol");
    }

    if (parsedUrl.hostname.includes("xn--")) {
      warnings.push("This URL contains internationalized (non-ASCII) characters");
    }
    return warnings;
  })();

  const domain = (() => {
    if (parsedUrl) {
      return parsedUrl.hostname;
    }
    console.error("Invalid URL in elicitation request.");
    return "Invalid URL";
  })();

  return (
    <div
      data-testid="elicitation-request"
      className="flex gap-4 p-4 border rounded-lg space-y-4"
    >
      <div className="flex-1 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded">
        <div className="space-y-2">
          <div className="mt-2">
            <h5 className="text-xs font-medium mb-1">Request Schema:</h5>
            <JsonView
              data={JSON.stringify(
                request.request,
                ["message", "url", "elicitationId"],
                2,
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6">
        <div className="space-y-3">
          {warnings.length > 0 &&
            warnings.map((msg, index) => (
              <div
                key={index}
                className="bg-yellow-100 border-l-4 border-yellow-500 p-2 text-xs text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200"
              >
                {msg}
              </div>
            ))}
          <p className="text-sm">{request.request.message}</p>
          <p className="text-sm font-semibold">Domain: {domain}</p>
          <p className="text-xs text-gray-600">
            Full URL: {request.request.url}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            type="button"
            onClick={handleAcceptAndOpen}
            disabled={!parsedUrl}
          >
            Accept and open
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
          <Button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(request.request.url);
                setCopied(true);
              } catch (error) {
                toast({
                  title: "Error",
                  description: `There was an error copying url to the clipboard: ${error instanceof Error ? error.message : String(error)}`,
                });
              }
            }}
          >
            {copied ? (
              <CheckCheck className="h-4 w-4 mr-2 dark:text-green-700 text-green-600" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            Copy URL
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ElicitationUrlRequest;
