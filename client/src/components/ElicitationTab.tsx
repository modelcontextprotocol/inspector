import { Alert, AlertDescription } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { JsonSchemaType } from "@/utils/jsonUtils";
import ElicitationFormRequest from "@/components/ElicitationFormRequest.tsx";
import ElicitationUrlRequest from "@/components/ElicitationUrlRequest.tsx";

export type FormElicitationRequestData = {
  mode?: "form";
  id: number;
  message: string;
  requestedSchema: JsonSchemaType;
};

export type UrlElicitationRequestData = {
  mode: "url";
  id: number;
  message: string;
  url: string;
  elicitationId: string;
};

export type ElicitationRequestData =
  | FormElicitationRequestData
  | UrlElicitationRequestData;

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

const isFormRequest = (
  req: PendingElicitationRequest,
): req is PendingElicitationRequest & {
  request: FormElicitationRequestData;
} => {
  const mode = req.request.mode;
  return mode === undefined || mode === null || mode === "form";
};

const isUrlElicitationRequest = (
  req: PendingElicitationRequest,
): req is PendingElicitationRequest & {
  request: UrlElicitationRequestData;
} => {
  return req.request.mode === "url";
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
          {pendingRequests.map((request) => {
            if (isFormRequest(request)) {
              return (
                <ElicitationFormRequest
                  key={request.id}
                  request={request}
                  onResolve={onResolve}
                />
              );
            } else if (isUrlElicitationRequest(request)) {
              return (
                <ElicitationUrlRequest
                  key={request.id}
                  request={request}
                  onResolve={onResolve}
                />
              );
            }
            return (
              <div
                key={request.id}
                className="flex flex-col gap-3 p-4 border rounded-lg"
              >
                <p className="text-sm">
                  Unsupported elicitation mode. You can decline or cancel this
                  request.
                </p>
                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onResolve(request.id, { action: "decline" })}
                  >
                    Decline
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onResolve(request.id, { action: "cancel" })}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}
          {pendingRequests.length === 0 && (
            <p className="text-gray-500">No pending requests</p>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ElicitationTab;
