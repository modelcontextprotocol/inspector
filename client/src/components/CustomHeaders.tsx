import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import {
  CustomHeaders as CustomHeadersType,
  CustomHeader,
  createEmptyHeader,
} from "@/lib/types/customHeaders";

interface CustomHeadersProps {
  headers: CustomHeadersType;
  onChange: (headers: CustomHeadersType) => void;
  className?: string;
}

const CustomHeaders = ({
  headers,
  onChange,
  className,
}: CustomHeadersProps) => {
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [visibleValues, setVisibleValues] = useState<Set<number>>(new Set());

  const updateHeader = (
    index: number,
    field: keyof CustomHeader,
    value: string | boolean,
  ) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    onChange(newHeaders);
  };

  const addHeader = () => {
    onChange([...headers, createEmptyHeader()]);
  };

  const removeHeader = (index: number) => {
    const newHeaders = headers.filter((_, i) => i !== index);
    onChange(newHeaders);
  };

  const toggleValueVisibility = (index: number) => {
    const newVisible = new Set(visibleValues);
    if (newVisible.has(index)) {
      newVisible.delete(index);
    } else {
      newVisible.add(index);
    }
    setVisibleValues(newVisible);
  };

  const switchToJsonMode = () => {
    const jsonObject: Record<string, string> = {};
    headers.forEach((header) => {
      if (header.enabled && header.name.trim() && header.value.trim()) {
        jsonObject[header.name.trim()] = header.value.trim();
      }
    });
    setJsonValue(JSON.stringify(jsonObject, null, 2));
    setJsonError(null);
    setIsJsonMode(true);
  };

  const switchToFormMode = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setJsonError("JSON must be an object with string key-value pairs");
        return;
      }

      const newHeaders: CustomHeadersType = Object.entries(parsed).map(
        ([name, value]) => ({
          name,
          value: String(value),
          enabled: true,
        }),
      );

      onChange(newHeaders);
      setJsonError(null);
      setIsJsonMode(false);
    } catch {
      setJsonError("Invalid JSON format");
    }
  };

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    setJsonError(null);
  };

  if (isJsonMode) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="flex justify-between items-center gap-2">
          <h4 className="text-sm font-semibold flex-shrink-0">
            Custom Headers (JSON)
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={switchToFormMode}
            className="flex-shrink-0"
          >
            Switch to Form
          </Button>
        </div>
        <div className="space-y-2">
          <Textarea
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder='{\n  "Authorization": "Bearer token123",\n  "X-Tenant-ID": "acme-inc",\n  "X-Environment": "staging"\n}'
            className="font-mono text-sm min-h-[100px] resize-none"
          />
          {jsonError && <p className="text-sm text-red-600">{jsonError}</p>}
          <p className="text-xs text-muted-foreground">
            Enter headers as a JSON object with string key-value pairs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex justify-between items-center gap-2">
        <h4 className="text-sm font-semibold flex-shrink-0">Custom Headers</h4>
        <div className="flex gap-1 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={switchToJsonMode}
            className="text-xs px-2"
          >
            JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHeader}
            className="text-xs px-2"
            data-testid="add-header-button"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {headers.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-sm">No custom headers configured</p>
          <p className="text-xs mt-1">Click "Add" to get started</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {headers.map((header, index) => (
            <div
              key={index}
              className="flex items-start gap-2 p-2 border rounded-md"
            >
              <Switch
                checked={header.enabled}
                onCheckedChange={(enabled) =>
                  updateHeader(index, "enabled", enabled)
                }
                className="shrink-0 mt-2"
              />
              <div className="flex-1 min-w-0 space-y-2">
                <Input
                  placeholder="Header Name"
                  value={header.name}
                  onChange={(e) => updateHeader(index, "name", e.target.value)}
                  className="font-mono text-xs"
                  data-testid={`header-name-input-${index}`}
                />
                <div className="relative">
                  <Input
                    placeholder="Header Value"
                    value={header.value}
                    onChange={(e) =>
                      updateHeader(index, "value", e.target.value)
                    }
                    type={visibleValues.has(index) ? "text" : "password"}
                    className="font-mono text-xs pr-8"
                    data-testid={`header-value-input-${index}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleValueVisibility(index)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                  >
                    {visibleValues.has(index) ? (
                      <EyeOff className="w-3 h-3" />
                    ) : (
                      <Eye className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeHeader(index)}
                className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0 mt-2"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {headers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Use the toggle to enable/disable headers. Only enabled headers with
          both name and value will be sent.
        </p>
      )}
    </div>
  );
};

export default CustomHeaders;
