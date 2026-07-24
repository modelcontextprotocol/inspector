import React, { useEffect, useRef, useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import JsonEditor from "@/components/JsonEditor";

interface MetadataTabProps {
  metadata: Record<string, unknown>;
  onMetadataChange: (metadata: Record<string, unknown>) => void;
}

const MetadataTab: React.FC<MetadataTabProps> = ({
  metadata,
  onMetadataChange,
}) => {
  const stringifyCompact = (
    value: Record<string, unknown> | null | undefined,
  ) => {
    if (!value || Object.keys(value).length === 0) {
      return "";
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  };

  const stringifyPretty = (value: Record<string, unknown>) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  };

  const initialCompact = stringifyCompact(metadata);
  const [jsonValue, setJsonValue] = useState<string>(() => {
    if (!initialCompact) {
      return "";
    }

    return stringifyPretty(metadata);
  });

  const [jsonError, setJsonError] = useState<string | null>(null);
  const lastMetadataStringRef = useRef<string>(initialCompact);

  useEffect(() => {
    const compact = stringifyCompact(metadata);

    if (compact === lastMetadataStringRef.current) {
      return;
    }

    lastMetadataStringRef.current = compact;

    if (!compact) {
      setJsonValue("");
      setJsonError(null);
      return;
    }

    if (metadata) {
      const pretty = stringifyPretty(metadata);
      setJsonValue(pretty);
      setJsonError(null);
    }
  }, [metadata]);

  const handleJsonChange = (value: string) => {
    setJsonValue(value);

    if (!value.trim()) {
      onMetadataChange({});
      lastMetadataStringRef.current = "";
      setJsonError(null);
      return;
    }

    try {
      const parsed = JSON.parse(value);

      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        setJsonError("Meta data must be a JSON object");
        return;
      }

      onMetadataChange(parsed);
      lastMetadataStringRef.current = JSON.stringify(parsed);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON format");
    }
  };

  const handlePrettyClick = () => {
    if (!jsonValue.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(jsonValue);

      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        setJsonError("Meta data must be a JSON object");
        return;
      }

      const pretty = stringifyPretty(parsed);
      setJsonValue(pretty);
      onMetadataChange(parsed);
      lastMetadataStringRef.current = JSON.stringify(parsed);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON format");
    }
  };

  return (
    <TabsContent value="metadata">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">Meta Data</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Provide an object containing key-value pairs that will be included
              in all MCP requests.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handlePrettyClick}
            className="flex-shrink-0"
          >
            Pretty
          </Button>
        </div>

        <JsonEditor
          value={jsonValue}
          onChange={handleJsonChange}
          error={jsonError || undefined}
        />
      </div>
    </TabsContent>
  );
};

export default MetadataTab;
