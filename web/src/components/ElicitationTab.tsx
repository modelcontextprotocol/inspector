import { Alert, AlertDescription } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { JsonSchemaType } from "@/utils/jsonUtils";
import ElicitationRequest from "./ElicitationRequest";

export interface ElicitationRequestData {
  id: number;
  message: string;
  requestedSchema: JsonSchemaType;
}

export interface ElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

export type PendingElicitationRequest = {
  id: number;
  request: ElicitationRequestData;
  originatingTab?: string;
};

export type Props = {
  pendingRequests: PendingElicitationRequest[];
  onResolve: (id: number, response: ElicitationResponse) => void;
};

const ElicitationTab = ({ pendingRequests, onResolve }: Props) => {
  return (
    <TabsContent value="elicitations">
      <div className="h-96">
        <Alert>
          <AlertDescription>
            When the server requests information from the user, requests will
            appear here for response.
          </AlertDescription>
        </Alert>
        <div className="mt-4 space-y-4">
          <h3 className="text-lg font-semibold">Recent Requests</h3>
          {pendingRequests.map((request) => (
            <ElicitationRequest
              key={request.id}
              request={request}
              onResolve={onResolve}
            />
          ))}
          {pendingRequests.length === 0 && (
            <p className="text-gray-500">No pending requests</p>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ElicitationTab;
