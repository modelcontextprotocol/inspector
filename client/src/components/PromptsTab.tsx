import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ListPromptsResult } from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import ListPane from "./ListPane";

export type Prompt = {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
};

const PromptsTab = ({
  prompts,
  listPrompts,
  getPrompt,
  selectedPrompt,
  setSelectedPrompt,
  promptContent,
  nextCursor,
  error,
}: {
  prompts: Prompt[];
  listPrompts: () => void;
  getPrompt: (name: string, args: Record<string, string>) => void;
  selectedPrompt: Prompt | null;
  setSelectedPrompt: (prompt: Prompt) => void;
  promptContent: string;
  nextCursor: ListPromptsResult["nextCursor"];
  error: string | null;
}) => {
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});

  const handleInputChange = (argName: string, value: string) => {
    setPromptArgs((prev) => ({ ...prev, [argName]: value }));
  };

  const handleGetPrompt = () => {
    if (selectedPrompt) {
      getPrompt(selectedPrompt.name, promptArgs);
    }
  };

  return (
    <TabsContent value="prompts" className="grid grid-cols-2 gap-4">
      <ListPane
        items={prompts}
        listItems={listPrompts}
        setSelectedItem={(prompt) => {
          setSelectedPrompt(prompt);
          setPromptArgs({});
        }}
        renderItem={(prompt) => (
          <>
            <span className="flex-1">{prompt.name}</span>
            <span className="text-sm text-gray-500">{prompt.description}</span>
          </>
        )}
        title="Prompts"
        buttonText={nextCursor ? "List More Prompts" : "List Prompts"}
        isButtonDisabled={!nextCursor && prompts.length > 0}
      />

      <div className="bg-card rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold">
            {selectedPrompt ? selectedPrompt.name : "Select a prompt"}
          </h3>
        </div>
        <div className="p-4">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : selectedPrompt ? (
            <div className="space-y-4">
              {selectedPrompt.description && (
                <p className="text-sm text-gray-600">
                  {selectedPrompt.description}
                </p>
              )}
              {selectedPrompt.arguments?.map((arg) => (
                <div key={arg.name}>
                  <Label htmlFor={arg.name}>{arg.name}</Label>
                  <Input
                    id={arg.name}
                    placeholder={`Enter ${arg.name}`}
                    value={promptArgs[arg.name] || ""}
                    onChange={(e) =>
                      handleInputChange(arg.name, e.target.value)
                    }
                  />
                  {arg.description && (
                    <p className="text-xs text-gray-500 mt-1">
                      {arg.description}
                      {arg.required && (
                        <span className="text-xs mt-1 ml-1">(Required)</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
              <Button onClick={handleGetPrompt} className="w-full">
                Get Prompt
              </Button>
              {promptContent && (
                <Textarea
                  value={promptContent}
                  readOnly
                  className="h-64 font-mono"
                />
              )}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                Select a prompt from the list to view and use it
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default PromptsTab;
