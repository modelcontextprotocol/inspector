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

const JsonEditor = ({ value, onChange, error }: JsonEditorProps) => {
  const formatJson = (json: string): string => {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };

  return (
    <div className="relative space-y-2">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(formatJson(value))}
        >
          Format JSON
        </Button>
      </div>
      <div
        className={`border rounded-md ${
          error ? "border-red-500" : "border-gray-200 dark:border-gray-800"
        }`}
      >
        <Editor
          value={value}
          onValueChange={onChange}
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
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
};

export default JsonEditor;
