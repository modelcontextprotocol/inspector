import { useState, useCallback, useMemo, memo } from "react";
import JsonView from "./JsonView";

interface ResourceLinkViewProps {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  resourceContent: string;
  onReadResource?: (uri: string) => void;
}

const ResourceLinkView = memo(
  ({
    uri,
    name,
    description,
    mimeType,
    resourceContent,
    onReadResource,
  }: ResourceLinkViewProps) => {
    const [{ expanded, loading }, setState] = useState({
      expanded: false,
      loading: false,
    });

    const expandedContent = useMemo(
      () =>
        expanded && resourceContent ? (
          <div className="mt-2">
            <div className="flex justify-between items-center mb-1">
              <span className="font-semibold text-green-600">Resource:</span>
            </div>
            <JsonView data={resourceContent} className="bg-background" />
          </div>
        ) : null,
      [expanded, resourceContent],
    );

    const handleClick = useCallback(() => {
      if (!onReadResource) return;
      if (!expanded) {
        setState((prev) => ({ ...prev, expanded: true, loading: true }));
        onReadResource(uri);
        setState((prev) => ({ ...prev, loading: false }));
      } else {
        setState((prev) => ({ ...prev, expanded: false }));
      }
    }, [expanded, onReadResource, uri]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && onReadResource) {
          e.preventDefault();
          handleClick();
        }
      },
      [handleClick, onReadResource],
    );

    return (
      <div className="text-sm text-foreground bg-secondary py-2 px-3 rounded">
        <div
          className="flex justify-between items-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
          onClick={onReadResource ? handleClick : undefined}
          onKeyDown={onReadResource ? handleKeyDown : undefined}
          tabIndex={onReadResource ? 0 : -1}
          role="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} resource ${uri}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline px-1 py-0.5 break-all font-mono flex-1 min-w-0">
                {uri}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {mimeType && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {mimeType}
                  </span>
                )}
                {onReadResource && (
                  <span className="ml-2 flex-shrink-0" aria-hidden="true">
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>{expanded ? "▼" : "▶"}</span>
                    )}
                  </span>
                )}
              </div>
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
        {expandedContent}
      </div>
    );
  },
);

export default ResourceLinkView;
