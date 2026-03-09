import { Alert, AlertDescription } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { JsonSchemaType } from "@/utils/jsonUtils";
import ElicitationRequest from "./ElicitationRequest";
import ElicitationUrlRequest from "./ElicitationUrlRequest";

/** Form-mode elicitation request payload */
export interface FormElicitationRequestData {
  mode: "form";
  id: number;
  message: string;
  requestedSchema: JsonSchemaType;
}

/** URL-mode elicitation request payload */
export interface UrlElicitationRequestData {
  mode: "url";
  id: number;
  message: string;
  url: string;
  elicitationId: string;
}

export type ElicitationRequestData =
  | FormElicitationRequestData
  | UrlElicitationRequestData;

export interface ElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

export type PendingElicitationRequest = {
  id: number;
  /** Client-side id (ElicitationCreateMessage.id) for syncing with getPendingElicitations() */
  elicitationId: string;
  request: ElicitationRequestData;
  originatingTab?: string;
};

/** Pending form-only request; use for ElicitationRequest component */
export type PendingFormElicitationRequest = PendingElicitationRequest & {
  request: FormElicitationRequestData;
};

/** Pending URL-only request; use for ElicitationUrlRequest component */
export type PendingUrlElicitationRequest = PendingElicitationRequest & {
  request: UrlElicitationRequestData;
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
          {pendingRequests.map((request) =>
            request.request.mode === "url" ? (
              <ElicitationUrlRequest
                key={request.id}
                request={request as PendingUrlElicitationRequest}
                onResolve={onResolve}
              />
            ) : (
              <ElicitationRequest
                key={request.id}
                request={request as PendingFormElicitationRequest}
                onResolve={onResolve}
              />
            ),
          )}
          {pendingRequests.length === 0 && (
            <p className="text-gray-500">No pending requests</p>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ElicitationTab;
