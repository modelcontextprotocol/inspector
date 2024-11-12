import { Menu, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

const Sidebar = ({ connectionStatus }: { connectionStatus: string }) => (
  <div className="w-64 bg-card border-r border-border">
    <div className="flex items-center p-4 border-b border-gray-200">
      <Menu className="w-6 h-6 text-gray-500" />
      <h1 className="ml-2 text-lg font-semibold">MCP Inspector</h1>
    </div>

    <div className="p-4">
      <div className="flex items-center space-x-2 mb-4">
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

      <Button variant="outline" className="w-full justify-start">
        <Settings className="w-4 h-4 mr-2" />
        Connection Settings
      </Button>
    </div>
  </div>
);

export default Sidebar;
