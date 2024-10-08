import { Send, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type Prompt = {
  id: string;
  name: string;
};

const PromptsTab = ({
  prompts,
  listPrompts,
  getPrompt,
  selectedPrompt,
  setSelectedPrompt,
  promptContent,
  error,
}: {
  prompts: Prompt[];
  listPrompts: () => void;
  getPrompt: (name: string) => void;
  selectedPrompt: Prompt | null;
  setSelectedPrompt: (prompt: Prompt) => void;
  promptContent: string;
  error: string | null;
}) => {
  console.log("prompts", prompts);
  return (
    <TabsContent value="prompts" className="grid grid-cols-2 gap-4">
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold">Prompts</h3>
        </div>
        <div className="p-4">
          <Button
            variant="outline"
            className="w-full mb-4"
            onClick={listPrompts}
          >
            List Prompts
          </Button>
          <div className="space-y-2">
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                onClick={() => {
                  setSelectedPrompt(prompt);
                  getPrompt(prompt.name);
                }}
              >
                <span className="flex-1">{prompt.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
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
              <Textarea
                value={promptContent}
                readOnly
                className="h-64 font-mono"
              />
              <div className="flex space-x-2">
                <Input placeholder="Enter your message" />
                <Button>
                  <Send className="w-4 h-4 mr-2" />
                  Send
                </Button>
              </div>
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
