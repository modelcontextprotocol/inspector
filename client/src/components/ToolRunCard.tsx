import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DynamicJsonForm from "./DynamicJsonForm";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Loader2, Send, Code2 } from "lucide-react";
import { useEffect, useState } from "react";

interface ToolRunCardProps {
  selectedTool: Tool | null;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
}

const ToolRunCard = ({ selectedTool, callTool }: ToolRunCardProps) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);

  useEffect(() => {
    const params = Object.entries(
      selectedTool?.inputSchema.properties ?? [],
    ).map(([key, value]) => [
      key,
      generateDefaultValue(value as JsonSchemaType),
    ]);
    setParams(Object.fromEntries(params));
  }, [selectedTool]);

  return (
    <div className="bg-gradient-to-br from-card/95 via-card to-card/95 backdrop-blur-sm rounded-xl shadow-lg border border-border/40 overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-border/60">
      {/* Header */}
      <div className="bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 backdrop-blur-sm p-3 border-b border-border/30">
        <div className="flex items-center space-x-2">
          <div className="flex-1">
            <h1 className="font-mono text-sm bg-gradient-to-r from-secondary/70 to-secondary/50 px-3 py-1.5 rounded-lg border border-border/30 text-foreground font-semibold shadow-sm inline-block">
              {selectedTool ? selectedTool.name : "Select a tool"}
            </h1>
            {selectedTool && (
              <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1">
                {selectedTool.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {selectedTool ? (
          <div className="space-y-3">
            {/* Parameters Section */}
            {Object.keys(selectedTool.inputSchema.properties ?? {}).length >
              0 && (
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 pb-1.5 border-b border-border/20">
                  <Code2 className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Parameters
                  </span>
                </div>

                <div className="space-y-2.5">
                  {Object.entries(
                    selectedTool.inputSchema.properties ?? [],
                  ).map(([key, value]) => {
                    const prop = value as JsonSchemaType;
                    return (
                      <div key={key} className="group">
                        {/* Parameter Name - Code Style */}
                        <div className="flex items-center space-x-1.5 mb-1.5">
                          <span className="font-mono text-xs bg-gradient-to-r from-secondary/80 to-secondary/60 px-2 py-1 rounded-md border border-border/30 text-foreground font-medium shadow-sm">
                            {key}
                          </span>
                          <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded font-medium">
                            {prop.type}
                          </span>
                        </div>

                        {/* Parameter Description */}
                        {prop.description && (
                          <p className="text-xs text-muted-foreground/80 mb-1.5 ml-0.5 italic line-clamp-1">
                            {prop.description}
                          </p>
                        )}

                        {/* Input Field */}
                        <div className="relative">
                          {prop.type === "boolean" ? (
                            <div className="flex items-center space-x-2 p-2.5 bg-gradient-to-r from-background/50 to-background/30 border border-border/30 rounded-lg hover:border-border/50 transition-all duration-200">
                              <Checkbox
                                id={key}
                                name={key}
                                checked={!!params[key]}
                                onCheckedChange={(checked: boolean) =>
                                  setParams({
                                    ...params,
                                    [key]: checked,
                                  })
                                }
                                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary h-3.5 w-3.5"
                              />
                              <label
                                htmlFor={key}
                                className="text-xs font-medium text-foreground cursor-pointer flex-1"
                              >
                                {prop.description || "Toggle this option"}
                              </label>
                            </div>
                          ) : prop.type === "string" ? (
                            <Textarea
                              id={key}
                              name={key}
                              placeholder={
                                prop.description || `Enter ${key}...`
                              }
                              value={(params[key] as string) ?? ""}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  [key]: e.target.value,
                                })
                              }
                              className="font-mono text-xs bg-gradient-to-br from-background/80 to-background/60 border-border/40 rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200 min-h-[60px] resize-none p-2"
                            />
                          ) : prop.type === "object" ||
                            prop.type === "array" ? (
                            <div className="bg-gradient-to-br from-background/80 to-background/60 border border-border/40 rounded-lg p-2.5 hover:border-border/60 transition-all duration-200">
                              <DynamicJsonForm
                                schema={{
                                  type: prop.type,
                                  properties: prop.properties,
                                  description: prop.description,
                                  items: prop.items,
                                }}
                                value={
                                  (params[key] as JsonValue) ??
                                  generateDefaultValue(prop)
                                }
                                onChange={(newValue: JsonValue) => {
                                  setParams({
                                    ...params,
                                    [key]: newValue,
                                  });
                                }}
                              />
                            </div>
                          ) : prop.type === "number" ||
                            prop.type === "integer" ? (
                            <Input
                              type="number"
                              id={key}
                              name={key}
                              placeholder={
                                prop.description || `Enter ${key}...`
                              }
                              value={(params[key] as string) ?? ""}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  [key]: Number(e.target.value),
                                })
                              }
                              className="font-mono text-xs bg-gradient-to-br from-background/80 to-background/60 border-border/40 rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200 h-8"
                            />
                          ) : (
                            <div className="bg-gradient-to-br from-background/80 to-background/60 border border-border/40 rounded-lg p-2.5 hover:border-border/60 transition-all duration-200">
                              <DynamicJsonForm
                                schema={{
                                  type: prop.type,
                                  properties: prop.properties,
                                  description: prop.description,
                                  items: prop.items,
                                }}
                                value={params[key] as JsonValue}
                                onChange={(newValue: JsonValue) => {
                                  setParams({
                                    ...params,
                                    [key]: newValue,
                                  });
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Run Button */}
            <div className="pt-2 border-t border-border/20">
              <Button
                onClick={async () => {
                  try {
                    setIsToolRunning(true);
                    await callTool(selectedTool.name, params);
                  } finally {
                    setIsToolRunning(false);
                  }
                }}
                disabled={isToolRunning}
                className="w-full h-8 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 text-primary-foreground font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] text-xs"
              >
                {isToolRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-2" />
                    Run Tool
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-muted/30 to-muted/50 flex items-center justify-center mb-3">
              <Code2 className="w-5 h-5 text-muted-foreground/60" />
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Ready to Execute
            </h4>
            <p className="text-muted-foreground text-xs max-w-sm">
              Select a tool from the list to configure its parameters and
              execute it
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolRunCard;
