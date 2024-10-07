import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

const RequestsTab = () => (
  <TabsContent value="requests" className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-4">
        <div className="flex space-x-2">
          <Input placeholder="Method name" />
          <Button>
            <Send className="w-4 h-4 mr-2" />
            Send
          </Button>
        </div>
        <Textarea
          placeholder="Request parameters (JSON)"
          className="h-64 font-mono"
        />
      </div>
      <div>
        <div className="bg-gray-50 p-4 rounded-lg h-96 font-mono text-sm overflow-auto">
          <div className="text-gray-500 mb-2">Response:</div>
          {/* Response content would go here */}
        </div>
      </div>
    </div>
  </TabsContent>
);

export default RequestsTab;
