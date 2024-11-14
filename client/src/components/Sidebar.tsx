import { useState } from "react";

import { Play, ChevronDown, ChevronRight, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SidebarProps {
  connectionStatus: "disconnected" | "connected" | "error";
  transportType: "stdio" | "sse";
  setTransportType: (type: "stdio" | "sse") => void;
  command: string;
  setCommand: (command: string) => void;
  args: string;
  setArgs: (args: string) => void;
  url: string;
  setUrl: (url: string) => void;
  env: Record<string, string>;
  setEnv: (env: Record<string, string>) => void;
  onConnect: () => void;
}

const Sidebar = ({
  connectionStatus,
  transportType,
  setTransportType,
  command,
  setCommand,
  args,
  setArgs,
  url,
  setUrl,
  env,
  setEnv,
  onConnect,
}: SidebarProps) => {
  const [showEnvVars, setShowEnvVars] = useState(false);

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
      <div className="flex items-center p-4 border-b border-gray-200">
        <Settings className="w-6 h-6 text-gray-500" />
        <h1 className="ml-2 text-lg font-semibold">MCP Inspector</h1>
      </div>

      <div className="p-4 flex-1 overflow-auto">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Transport Type</label>
            <Select
              value={transportType}
              onValueChange={(value: "stdio" | "sse") =>
                setTransportType(value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select transport type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">STDIO</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {transportType === "stdio" ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Command</label>
                <Input
                  placeholder="Command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Arguments</label>
                <Input
                  placeholder="Arguments (space-separated)"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">URL</label>
              <Input
                placeholder="URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          {transportType === "stdio" && (
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() => setShowEnvVars(!showEnvVars)}
                className="flex items-center w-full"
              >
                {showEnvVars ? (
                  <ChevronDown className="w-4 h-4 mr-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 mr-2" />
                )}
                Environment Variables
              </Button>
              {showEnvVars && (
                <div className="space-y-2">
                  {Object.entries(env).map(([key, value], idx) => (
                    <div key={idx} className="grid grid-cols-[1fr,auto] gap-2">
                      <div className="space-y-1">
                        <Input
                          placeholder="Key"
                          value={key}
                          onChange={(e) => {
                            const newEnv = { ...env };
                            delete newEnv[key];
                            newEnv[e.target.value] = value;
                            setEnv(newEnv);
                          }}
                        />
                        <Input
                          placeholder="Value"
                          value={value}
                          onChange={(e) => {
                            const newEnv = { ...env };
                            newEnv[key] = e.target.value;
                            setEnv(newEnv);
                          }}
                        />
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { [key]: removed, ...rest } = env;
                          setEnv(rest);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() => {
                      const newEnv = { ...env };
                      newEnv[""] = "";
                      setEnv(newEnv);
                    }}
                  >
                    Add Environment Variable
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button className="w-full" onClick={onConnect}>
              <Play className="w-4 h-4 mr-2" />
              Connect
            </Button>

            <div className="flex items-center justify-center space-x-2 mb-4">
              <div
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-green-500"
                    : connectionStatus === "error"
                      ? "bg-red-500"
                      : "bg-gray-500"
                }`}
              />
              <span className="text-sm text-gray-600">
                {connectionStatus === "connected"
                  ? "Connected"
                  : connectionStatus === "error"
                    ? "Connection Error"
                    : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
