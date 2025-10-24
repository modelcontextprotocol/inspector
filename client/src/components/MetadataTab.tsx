import React, { useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus } from "lucide-react";

interface MetadataEntry {
  key: string;
  value: string;
}

interface MetadataTabProps {
  metadata: Record<string, string>;
  onMetadataChange: (metadata: Record<string, string>) => void;
}

const MetadataTab: React.FC<MetadataTabProps> = ({
  metadata,
  onMetadataChange,
}) => {
  const [entries, setEntries] = useState<MetadataEntry[]>(() => {
    return Object.entries(metadata).map(([key, value]) => ({ key, value }));
  });

  const addEntry = () => {
    setEntries([...entries, { key: "", value: "" }]);
  };

  const removeEntry = (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index);
    setEntries(newEntries);
    updateMetadata(newEntries);
  };

  const updateEntry = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    const newEntries = [...entries];
    newEntries[index][field] = value;
    setEntries(newEntries);
    updateMetadata(newEntries);
  };

  const updateMetadata = (newEntries: MetadataEntry[]) => {
    const metadataObject: Record<string, string> = {};
    newEntries.forEach(({ key, value }) => {
      if (key.trim() && value.trim()) {
        metadataObject[key.trim()] = value.trim();
      }
    });
    onMetadataChange(metadataObject);
  };

  return (
    <TabsContent value="metadata">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Metadata</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Key-value pairs that will be included in all MCP requests
            </p>
          </div>
          <Button onClick={addEntry} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Entry
          </Button>
        </div>

        <div className="space-y-3">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-center space-x-2">
              <div className="flex-1">
                <Label htmlFor={`key-${index}`} className="sr-only">
                  Key
                </Label>
                <Input
                  id={`key-${index}`}
                  placeholder="Key"
                  value={entry.key}
                  onChange={(e) => updateEntry(index, "key", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor={`value-${index}`} className="sr-only">
                  Value
                </Label>
                <Input
                  id={`value-${index}`}
                  placeholder="Value"
                  value={entry.value}
                  onChange={(e) => updateEntry(index, "value", e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeEntry(index)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        {entries.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No metadata entries. Click "Add Entry" to add key-value pairs.
            </p>
          </div>
        )}
      </div>
    </TabsContent>
  );
};

export default MetadataTab;
