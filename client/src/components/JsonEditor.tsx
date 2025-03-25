import { useState, useEffect } from "react";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/themes/prism.css";
import { Button } from "@/components/ui/button";

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const JsonEditor = ({
  value,
  onChange,
  error: externalError,
}: JsonEditorProps) => {
  const [editorContent, setEditorContent] = useState(value);
  const [internalError, setInternalError] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    setEditorContent(value);
  }, [value]);

  const formatJson = (json: string): string => {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };

  const handleEditorChange = (newContent: string) => {
    setEditorContent(newContent);
    setInternalError(undefined);
    onChange(newContent);
  };

  const handleFormatJson = () => {
    try {
      const formatted = formatJson(editorContent);
      setEditorContent(formatted);
      onChange(formatted);
      setInternalError(undefined);
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const displayError = internalError || externalError;

  return (
    <div className="relative space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleFormatJson}>
          Format JSON
        </Button>
      </div>
      <div
        className={`border rounded-md ${
          displayError
            ? "border-red-500"
            : "border-gray-200 dark:border-gray-800"
        }`}
      >
        <Editor
          value={editorContent}
          onValueChange={handleEditorChange}
          highlight={(code) =>
            Prism.highlight(code, Prism.languages.json, "json")
          }
          padding={10}
          style={{
            fontFamily: '"Fira code", "Fira Mono", monospace',
            fontSize: 14,
            backgroundColor: "transparent",
            minHeight: "100px",
          }}
          className="w-full"
        />
      </div>
      {displayError && (
        <p className="text-sm text-red-500 mt-1">{displayError}</p>
      )}
    </div>
  );
};

export default JsonEditor;
