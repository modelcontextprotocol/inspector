import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  ListResourcesResult,
  Resource,
  ResourceTemplate,
  ListResourceTemplatesResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle, ChevronRight, FileText, RefreshCw } from "lucide-react";
import ListPane from "./ListPane";
import { useState } from "react";

const ResourcesTab = ({
  resources,
  resourceTemplates,
  listResources,
  listResourceTemplates,
  readResource,
  selectedResource,
  setSelectedResource,
  resourceContent,
  nextCursor,
  nextTemplateCursor,
  error,
}: {
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  listResources: () => void;
  listResourceTemplates: () => void;
  readResource: (uri: string) => void;
  selectedResource: Resource | null;
  setSelectedResource: (resource: Resource | null) => void;
  resourceContent: string;
  nextCursor: ListResourcesResult["nextCursor"];
  nextTemplateCursor: ListResourceTemplatesResult["nextCursor"];
  error: string | null;
}) => {
  const [selectedTemplate, setSelectedTemplate] =
    useState<ResourceTemplate | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    {},
  );

  const fillTemplate = (
    template: string,
    values: Record<string, string>,
  ): string => {
    return template.replace(
      /{([^}]+)}/g,
      (_, key) => values[key] || `{${key}}`,
    );
  };

  const handleReadTemplateResource = () => {
    if (selectedTemplate) {
      const uri = fillTemplate(selectedTemplate.uriTemplate, templateValues);
      readResource(uri);
      setSelectedTemplate(null);
      // We don't have the full Resource object here, so we create a partial one
      setSelectedResource({ uri, name: uri } as Resource);
    }
  };

  return (
    <TabsContent value="resources" className="grid grid-cols-3 gap-4">
      <ListPane
        items={resources}
        listItems={listResources}
        setSelectedItem={(resource) => {
          setSelectedResource(resource);
          readResource(resource.uri);
          setSelectedTemplate(null);
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
        buttonText={nextCursor ? "List More Resources" : "List Resources"}
        isButtonDisabled={!nextCursor && resources.length > 0}
      />

      <ListPane
        items={resourceTemplates}
        listItems={listResourceTemplates}
        setSelectedItem={(template) => {
          setSelectedTemplate(template);
          setSelectedResource(null);
          setTemplateValues({});
        }}
        renderItem={(template) => (
          <div className="flex items-center w-full">
            <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-gray-500" />
            <span className="flex-1 truncate" title={template.uriTemplate}>
              {template.name}
            </span>
            <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-400" />
          </div>
        )}
        title="Resource Templates"
        buttonText={
          nextTemplateCursor ? "List More Templates" : "List Templates"
        }
        isButtonDisabled={!nextTemplateCursor && resourceTemplates.length > 0}
      />

      <div className="bg-card rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3
            className="font-semibold truncate"
            title={selectedResource?.name || selectedTemplate?.name}
          >
            {selectedResource
              ? selectedResource.name
              : selectedTemplate
                ? selectedTemplate.name
                : "Select a resource or template"}
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
            <pre className="bg-gray-50 dark:bg-gray-800 p-4 rounded text-sm overflow-auto max-h-96 whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
              {resourceContent}
            </pre>
          ) : selectedTemplate ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {selectedTemplate.description}
              </p>
              {selectedTemplate.uriTemplate
                .match(/{([^}]+)}/g)
                ?.map((param) => {
                  const key = param.slice(1, -1);
                  return (
                    <div key={key}>
                      <label
                        htmlFor={key}
                        className="block text-sm font-medium text-gray-700"
                      >
                        {key}
                      </label>
                      <Input
                        id={key}
                        value={templateValues[key] || ""}
                        onChange={(e) =>
                          setTemplateValues({
                            ...templateValues,
                            [key]: e.target.value,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                  );
                })}
              <Button
                onClick={handleReadTemplateResource}
                disabled={Object.keys(templateValues).length === 0}
              >
                Read Resource
              </Button>
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                Select a resource or template from the list to view its contents
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ResourcesTab;
