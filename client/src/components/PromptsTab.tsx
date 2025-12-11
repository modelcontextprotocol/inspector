import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";

import {
  ListPromptsResult,
  PromptReference,
  ResourceReference,
} from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import ListPane from "./ListPane";
import { useCompletionState } from "@/lib/hooks/useCompletionState";
import JsonView from "./JsonView";
import IconDisplay, { WithIcons } from "./IconDisplay";

export type Prompt = {
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
  icons?: { src: string; mimeType?: string; sizes?: string[] }[];
};

const PromptsTab = ({
  prompts,
  listPrompts,
  clearPrompts,
  getPrompt,
  selectedPrompt,
  setSelectedPrompt,
  handleCompletion,
  completionsSupported,
  promptContent,
  nextCursor,
  error,
}: {
  prompts: Prompt[];
  listPrompts: () => void;
  clearPrompts: () => void;
  getPrompt: (name: string, args: Record<string, string>) => void;
  selectedPrompt: Prompt | null;
  setSelectedPrompt: (prompt: Prompt | null) => void;
  handleCompletion: (
    ref: PromptReference | ResourceReference,
    argName: string,
    value: string,
    context?: Record<string, string>,
  ) => Promise<string[]>;
  completionsSupported: boolean;
  promptContent: string;
  nextCursor: ListPromptsResult["nextCursor"];
  error: string | null;
}) => {
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const { completions, clearCompletions, requestCompletions } =
    useCompletionState(handleCompletion, completionsSupported);

  useEffect(() => {
    clearCompletions();
  }, [clearCompletions, selectedPrompt]);

  const triggerCompletions = (argName: string, value: string) => {
    if (selectedPrompt) {
      requestCompletions(
        {
          type: "ref/prompt",
          name: selectedPrompt.name,
        },
        argName,
        value,
        promptArgs,
      );
    }
  };

  const handleInputChange = async (argName: string, value: string) => {
    setPromptArgs((prev) => ({ ...prev, [argName]: value }));
    triggerCompletions(argName, value);
  };

  const handleFocus = async (argName: string) => {
    const currentValue = promptArgs[argName] || "";
    triggerCompletions(argName, currentValue);
  };

  const handleGetPrompt = () => {
    if (selectedPrompt) {
      getPrompt(selectedPrompt.name, promptArgs);
    }
  };

  return (
    <TabsContent value="prompts">
      <div className="grid grid-cols-2 gap-4">
        <ListPane
          items={prompts}
          listItems={listPrompts}
          clearItems={() => {
            clearPrompts();
            setSelectedPrompt(null);
          }}
          setSelectedItem={(prompt) => {
            setSelectedPrompt(prompt);
            setPromptArgs({});
          }}
          renderItem={(prompt) => (
            <div className="flex items-start w-full gap-2">
              <div className="flex-shrink-0 mt-1">
                <IconDisplay icons={prompt.icons} size="sm" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="truncate">{prompt.name}</span>
                <span className="text-sm text-gray-500 text-left line-clamp-2">
                  {prompt.description}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-400 mt-1" />
            </div>
          )}
          title="Prompts"
          buttonText={nextCursor ? "List More Prompts" : "List Prompts"}
          isButtonDisabled={!nextCursor && prompts.length > 0}
        />

        <div className="bg-card border border-border rounded-lg shadow">
          <div className="p-4 border-b border-gray-200 dark:border-border">
            <div className="flex items-center gap-2">
              {selectedPrompt && (
                <IconDisplay
                  icons={(selectedPrompt as WithIcons).icons}
                  size="md"
                />
              )}
              <h3 className="font-semibold">
                {selectedPrompt ? selectedPrompt.name : "Select a prompt"}
              </h3>
            </div>
          </div>
          <div className="p-4">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="break-all">
                  {error}
                </AlertDescription>
              </Alert>
            ) : selectedPrompt ? (
              <div className="space-y-4">
                {selectedPrompt.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedPrompt.description}
                  </p>
                )}
                {selectedPrompt.arguments?.map((arg) => (
                  <div key={arg.name}>
                    <Label htmlFor={arg.name}>{arg.name}</Label>
                    <Combobox
                      id={arg.name}
                      placeholder={`Enter ${arg.name}`}
                      value={promptArgs[arg.name] || ""}
                      onChange={(value) => handleInputChange(arg.name, value)}
                      onInputChange={(value) =>
                        handleInputChange(arg.name, value)
                      }
                      onFocus={() => handleFocus(arg.name)}
                      options={completions[arg.name] || []}
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
                  <JsonView data={promptContent} withCopyButton={false} />
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
      </div>
    </TabsContent>
  );
};

export default PromptsTab;
