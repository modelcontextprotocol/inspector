import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { TabsContent } from "@/components/ui/tabs";
import {
  ListResourcesResult,
  Resource,
  ResourceTemplate,
  ListResourceTemplatesResult,
  ResourceReference,
  PromptReference,
} from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle, ChevronRight, FileText, RefreshCw } from "lucide-react";
import ListPane from "./ListPane";
import { useEffect, useState } from "react";
import { useCompletionState } from "@/lib/hooks/useCompletionState";
import JsonView from "./JsonView";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import IconDisplay, { WithIcons } from "./IconDisplay";

const ResourcesTab = ({
  resources,
  resourceTemplates,
  listResources,
  clearResources,
  listResourceTemplates,
  clearResourceTemplates,
  readResource,
  selectedResource,
  setSelectedResource,
  resourceSubscriptionsSupported,
  resourceSubscriptions,
  subscribeToResource,
  unsubscribeFromResource,
  handleCompletion,
  completionsSupported,
  resourceContent,
  nextCursor,
  nextTemplateCursor,
  error,
}: {
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  listResources: () => void;
  clearResources: () => void;
  listResourceTemplates: () => void;
  clearResourceTemplates: () => void;
  readResource: (uri: string) => void;
  selectedResource: Resource | null;
  setSelectedResource: (resource: Resource | null) => void;
  handleCompletion: (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
    context?: Record<string, string>,
  ) => Promise<string[]>;
  completionsSupported: boolean;
  resourceContent: string;
  nextCursor: ListResourcesResult["nextCursor"];
  nextTemplateCursor: ListResourceTemplatesResult["nextCursor"];
  error: string | null;
  resourceSubscriptionsSupported: boolean;
  resourceSubscriptions: Set<string>;
  subscribeToResource: (uri: string) => void;
  unsubscribeFromResource: (uri: string) => void;
}) => {
  const [selectedTemplate, setSelectedTemplate] =
    useState<ResourceTemplate | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    {},
  );

  const { completions, clearCompletions, requestCompletions } =
    useCompletionState(handleCompletion, completionsSupported);

  useEffect(() => {
    clearCompletions();
  }, [clearCompletions]);

  const fillTemplate = (
    template: string,
    values: Record<string, string>,
  ): string => {
    return new UriTemplate(template).expand(values);
  };

  const handleTemplateValueChange = async (key: string, value: string) => {
    setTemplateValues((prev) => ({ ...prev, [key]: value }));

    if (selectedTemplate?.uriTemplate) {
      requestCompletions(
        {
          type: "ref/resource",
          uri: selectedTemplate.uriTemplate,
        },
        key,
        value,
        templateValues,
      );
    }
  };

  const handleReadTemplateResource = () => {
    if (selectedTemplate) {
      const uri = fillTemplate(selectedTemplate.uriTemplate, templateValues);
      readResource(uri);
      // We don't have the full Resource object here, so we create a partial one
      setSelectedResource({ uri, name: uri } as Resource);
    }
  };

  return (
    <TabsContent value="resources">
      <div className="grid grid-cols-3 gap-4">
        <ListPane
          items={resources}
          listItems={listResources}
          clearItems={() => {
            clearResources();
            // Condition to check if selected resource is not resource template's resource
            if (!selectedTemplate) {
              setSelectedResource(null);
            }
          }}
          setSelectedItem={(resource) => {
            setSelectedResource(resource);
            readResource(resource.uri);
            setSelectedTemplate(null);
          }}
          renderItem={(resource) => (
            <div className="flex items-center w-full">
              <IconDisplay icons={(resource as WithIcons).icons} size="sm" />
              {!(resource as WithIcons).icons && (
                <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-gray-500" />
              )}
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
          clearItems={() => {
            clearResourceTemplates();
            // Condition to check if selected resource is resource template's resource
            if (selectedTemplate) {
              setSelectedResource(null);
            }
            setSelectedTemplate(null);
          }}
          setSelectedItem={(template) => {
            setSelectedTemplate(template);
            setSelectedResource(null);
            setTemplateValues({});
          }}
          renderItem={(template) => (
            <div className="flex items-center w-full">
              <IconDisplay icons={(template as WithIcons).icons} size="sm" />
              {!(template as WithIcons).icons && (
                <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-gray-500" />
              )}
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

        <div className="bg-card border border-border rounded-lg shadow">
          <div className="p-4 border-b border-gray-200 dark:border-border flex justify-between items-center">
            <div className="flex items-center gap-2 truncate">
              {(selectedResource || selectedTemplate) && (
                <IconDisplay
                  icons={
                    ((selectedResource || selectedTemplate) as WithIcons).icons
                  }
                  size="md"
                />
              )}
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
            </div>
            {selectedResource && (
              <div className="flex row-auto gap-1 justify-end w-2/5">
                {resourceSubscriptionsSupported &&
                  !resourceSubscriptions.has(selectedResource.uri) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => subscribeToResource(selectedResource.uri)}
                    >
                      Subscribe
                    </Button>
                  )}
                {resourceSubscriptionsSupported &&
                  resourceSubscriptions.has(selectedResource.uri) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        unsubscribeFromResource(selectedResource.uri)
                      }
                    >
                      Unsubscribe
                    </Button>
                  )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => readResource(selectedResource.uri)}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </div>
            )}
          </div>
          <div className="p-4">
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="break-all">
                  {error}
                </AlertDescription>
              </Alert>
            ) : selectedResource ? (
              <JsonView
                data={resourceContent}
                className="bg-gray-50 dark:bg-gray-800 p-4 rounded text-sm overflow-auto max-h-96 text-gray-900 dark:text-gray-100"
              />
            ) : selectedTemplate ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {selectedTemplate.description}
                </p>
                {new UriTemplate(
                  selectedTemplate.uriTemplate,
                ).variableNames?.map((key) => {
                  return (
                    <div key={key}>
                      <Label htmlFor={key}>{key}</Label>
                      <Combobox
                        id={key}
                        placeholder={`Enter ${key}`}
                        value={templateValues[key] || ""}
                        onChange={(value) =>
                          handleTemplateValueChange(key, value)
                        }
                        onInputChange={(value) =>
                          handleTemplateValueChange(key, value)
                        }
                        options={completions[key] || []}
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
                  Select a resource or template from the list to view its
                  contents
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default ResourcesTab;
