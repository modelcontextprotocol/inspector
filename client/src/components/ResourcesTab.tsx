import {
  FileText,
  PlayCircle,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";

export type Resource = {
  uri: string;
};

const ResourcesTab = ({
  resources,
  listResources,
  readResource,
  selectedResource,
  setSelectedResource,
  resourceContent,
  error,
}: {
  resources: Resource[];
  listResources: () => void;
  readResource: (uri: string) => void;
  selectedResource: Resource | null;
  setSelectedResource: (resource: Resource) => void;
  resourceContent: string;
  error: string | null;
}) => (
  <TabsContent value="resources" className="grid grid-cols-2 gap-4">
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold">Resources</h3>
      </div>
      <div className="p-4">
        <Button
          variant="outline"
          className="w-full mb-4"
          onClick={listResources}
        >
          <PlayCircle className="w-4 h-4 mr-2" />
          List Resources
        </Button>
        <div className="space-y-2">
          {resources.map((resource, index) => (
            <div
              key={index}
              className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
              onClick={() => {
                setSelectedResource(resource);
                readResource(resource.uri);
              }}
            >
              <FileText className="w-4 h-4 mr-2 text-gray-500" />
              <span className="flex-1">{resource.uri}</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="font-semibold">
          {selectedResource ? selectedResource.uri : "Select a resource"}
        </h3>
        {selectedResource && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => readResource(selectedResource.uri)}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>
      <div className="p-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : selectedResource ? (
          <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto max-h-96 whitespace-pre-wrap break-words">
            {resourceContent}
          </pre>
        ) : (
          <Alert>
            <AlertDescription>
              Select a resource from the list to view its contents
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  </TabsContent>
);

export default ResourcesTab;
