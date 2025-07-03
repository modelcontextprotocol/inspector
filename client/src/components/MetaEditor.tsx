import React, { useState, useEffect } from "react";
import JsonEditor from "./JsonEditor";
import { Button } from "./ui/button"; // Import Button
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";

interface MetaEditorProps {
  onChange: (value: Record<string, unknown> | null) => void;
  initialCollapsed?: boolean;
  initialValue?: Record<string, unknown>; // Default for the editor's content
}

const MetaEditor: React.FC<MetaEditorProps> = ({
  onChange,
  initialCollapsed = true,
  initialValue = {}, // This ensures the editor has a default of {}
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [jsonString, setJsonString] = useState<string>(() => {
    try {
      return JSON.stringify(initialValue, null, 2);
    } catch {
      return "{}";
    }
  });
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (isCollapsed) {
      onChange(null);
    } else {
      try {
        const parsedJson = JSON.parse(jsonString);
        onChange(parsedJson);
        setParseError(null);
      } catch (e) {
        onChange(null);
      }
    }
  }, [isCollapsed, jsonString, onChange]);

  const handleToggleCollapse = () => {
    setIsCollapsed((prevCollapsed) => !prevCollapsed);
    // onChange will be handled by the useEffect above based on the new isCollapsed state
  };

  const handleEditorChange = (newJsonString: string) => {
    console.log("change");
    setJsonString(newJsonString);
    try {
      JSON.parse(newJsonString);
      setParseError(null); // Clear error if current input is valid
    } catch (e) {
      setParseError("Invalid JSON format."); // Set error for JsonEditor to display
    }
  };

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        onClick={handleToggleCollapse}
        className={cn(
          "w-full mb-2",
          isCollapsed || "border-destructive",
          "justify-start pl-2",
        )} // Full-width and preserve margin
      >
        <div className="mr-1">
          {isCollapsed ? <Plus size="16" /> : <Minus size="16" />}
        </div>
        {isCollapsed ? "Add" : "Remove"} Request Metadata
      </Button>
      {!isCollapsed && (
        <JsonEditor
          value={jsonString}
          onChange={handleEditorChange}
          error={parseError || undefined}
        />
      )}
    </div>
  );
};

export default MetaEditor;
