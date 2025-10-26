import { TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Files, Hammer, MessageSquare } from "lucide-react";

interface OverviewTabProps {
  serverCapabilities: any;
  transportType: "stdio" | "sse" | "streamable-http";
  command: string;
  args: string;
  sseUrl: string;
}

const OverviewTab = ({
  serverCapabilities,
  transportType,
  command,
  args,
  sseUrl,
}: OverviewTabProps) => {
  return (
    <TabsContent value="overview">
      <Card>
        <CardHeader>
          <CardTitle>Server Overview</CardTitle>
          <CardDescription>
            Server capabilities and configuration information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Server Capabilities Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <Files className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                Resources:{" "}
                {serverCapabilities?.resources ? "Supported" : "Not supported"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                Prompts:{" "}
                {serverCapabilities?.prompts ? "Supported" : "Not supported"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Hammer className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                Tools:{" "}
                {serverCapabilities?.tools ? "Supported" : "Not supported"}
              </span>
            </div>
          </div>

          {/* Server Configuration Section */}
          <div className="pt-4 border-t">
            <h4 className="font-medium mb-2">Server Configuration</h4>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div>Transport: {transportType}</div>
              {transportType === "stdio" && (
                <>
                  <div>Command: {command}</div>
                  {args && <div>Arguments: {args}</div>}
                </>
              )}
              {(transportType === "streamable-http" ||
                transportType === "sse") && <div>URL: {sseUrl}</div>}
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
};

export default OverviewTab;
