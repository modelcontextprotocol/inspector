import { useState, useCallback, useEffect } from "react";
import { Copy, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/useToast";

interface ResourceLinkViewProps {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

const ResourceLinkView = ({
  uri,
  name,
  description,
  mimeType,
}: ResourceLinkViewProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (copied) {
      timeoutId = setTimeout(() => {
        setCopied(false);
      }, 500);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [copied]);

  const handleCopyUri = useCallback(() => {
    try {
      navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch (error) {
      toast({
        title: "Error",
        description: `There was an error copying URI to clipboard: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  }, [uri, toast]);

  const displayName = name || new URL(uri).pathname.split("/").pop() || uri;

  return (
    <div
      className="p-4 border rounded relative bg-gray-50 dark:bg-gray-800"
      role="article"
      aria-label={`Resource link: ${displayName}`}
    >
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2"
        onClick={handleCopyUri}
      >
        {copied ? (
          <CheckCheck className="size-4 dark:text-green-700 text-green-600" />
        ) : (
          <Copy className="size-4 text-foreground" />
        )}
      </Button>

      <div className="pr-10">
        <div className="flex items-start justify-between gap-2 mb-2">
          <a
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-1 py-0.5 break-all font-mono flex-1 min-w-0"
            aria-label={`Open resource: ${uri}`}
          >
            {uri}
          </a>
          {mimeType && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 flex-shrink-0">
              {mimeType}
            </span>
          )}
        </div>

        {name && (
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">
            {name}
          </div>
        )}

        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  );
};

export default ResourceLinkView;
