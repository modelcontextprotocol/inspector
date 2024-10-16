import { FileText, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TabsContent } from "@/components/ui/tabs";
import { Resource } from "mcp-typescript/types.js";
import ListPane from "./ListPane";

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
  readResource: (uri: URL) => void;
  selectedResource: Resource | null;
  setSelectedResource: (resource: Resource) => void;
  resourceContent: string;
  error: string | null;
}) => (
  <TabsContent value="resources" className="grid grid-cols-2 gap-4">
    <ListPane
      items={resources}
      listItems={listResources}
      setSelectedItem={(resource) => {
        setSelectedResource(resource);
        readResource(resource.uri);
      }}
      renderItem={(resource) => (
        <div className="flex items-center w-full">
          <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-gray-500" />
          <span className="flex-1 truncate" title={resource.uri.toString()}>
            {resource.name}
          </span>
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-400" />
        </div>
      )}
      title="Resources"
      buttonText="List Resources"
    />

    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="font-semibold truncate" title={selectedResource?.name}>
          {selectedResource ? selectedResource.name : "Select a resource"}
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
