import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

export type PendingRequest = {
  id: number;
  request: CreateMessageRequest;
};

export type Props = {
  pendingRequests: PendingRequest[];
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
};

const SamplingTab = ({ pendingRequests, onApprove, onReject }: Props) => {
  const handleApprove = (id: number) => {
    // For now, just return a stub response
    onApprove(id, {
      model: "stub-model",
      stopReason: "endTurn",
      role: "assistant",
      content: {
        type: "text",
        text: "This is a stub response.",
      },
    });
  };

  return (
    <TabsContent value="sampling" className="h-96">
      <Alert>
        <AlertDescription>
          When the server requests LLM sampling, requests will appear here for
          approval.
        </AlertDescription>
      </Alert>
      <div className="mt-4 space-y-4">
        <h3 className="text-lg font-semibold">Recent Requests</h3>
        {pendingRequests.map((request) => (
          <div key={request.id} className="p-4 border rounded-lg space-y-4">
            <pre className="bg-gray-50 p-2 rounded">
              {JSON.stringify(request.request, null, 2)}
            </pre>
            <div className="flex space-x-2">
              <Button onClick={() => handleApprove(request.id)}>Approve</Button>
              <Button variant="outline" onClick={() => onReject(request.id)}>
                Reject
              </Button>
            </div>
          </div>
        ))}
        {pendingRequests.length === 0 && (
          <p className="text-gray-500">No pending requests</p>
        )}
      </div>
    </TabsContent>
  );
};

export default SamplingTab;
