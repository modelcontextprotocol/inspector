import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ExternalLink, Copy, XCircle, Ban } from "lucide-react";
import {
  PendingUrlElicitationRequest,
  ElicitationResponse,
} from "./ElicitationTab";

export type ElicitationUrlRequestProps = {
  request: PendingUrlElicitationRequest;
  onResolve: (id: number, response: ElicitationResponse) => void;
};

function getUrlWarnings(url: string): string[] {
  const warnings: string[] = [];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      warnings.push("URL does not use HTTPS. Only open links you trust.");
    }
    if (/[^\x20-\x7E]/.test(url)) {
      warnings.push(
        "URL contains non-ASCII characters. Check the address to avoid homograph attacks.",
      );
    }
  } catch {
    warnings.push("URL is not a valid link.");
  }
  return warnings;
}

const ElicitationUrlRequest = ({
  request,
  onResolve,
}: ElicitationUrlRequestProps) => {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const { message, url } = request.request;

  const warnings = useMemo(() => getUrlWarnings(url), [url]);

  const handleAcceptAndOpen = () => {
    window.open(url, "_blank", "noopener,noreferrer");
    onResolve(request.id, { action: "accept" });
  };

  const handleAccept = () => {
    onResolve(request.id, { action: "accept" });
  };

  const handleDecline = () => {
    onResolve(request.id, { action: "decline" });
  };

  const handleCancel = () => {
    onResolve(request.id, { action: "cancel" });
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Failed to copy");
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  return (
    <div
      data-testid="elicitation-url-request"
      className="flex gap-4 p-4 border rounded-lg space-y-4"
    >
      <div className="flex-1 space-y-4">
        <div className="space-y-2">
          <h4 className="font-semibold">URL Elicitation</h4>
          <p className="text-sm">{message}</p>
        </div>

        <div className="space-y-1">
          <h5 className="text-xs font-medium text-muted-foreground">URL</h5>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline break-all"
            >
              {url}
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopyUrl}
              data-testid="copy-url-button"
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy URL
            </Button>
            {copyFeedback && (
              <span className="text-xs text-muted-foreground">
                {copyFeedback}
              </span>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <Alert variant="destructive" data-testid="url-warnings">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Security warning</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={handleAcceptAndOpen}
            data-testid="accept-and-open-button"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Accept and open URL
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleAccept}
            data-testid="accept-button"
          >
            Accept
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDecline}
            data-testid="decline-button"
          >
            <Ban className="h-4 w-4 mr-2" />
            Decline
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            data-testid="cancel-button"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ElicitationUrlRequest;
