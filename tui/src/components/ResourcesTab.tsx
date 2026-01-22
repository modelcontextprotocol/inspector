import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";

interface ResourceTemplate {
  name: string;
  uriTemplate: string;
  description?: string;
}

interface ResourcesTabProps {
  resources: any[];
  resourceTemplates?: ResourceTemplate[];
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "list" | "details" | null;
  onViewDetails?: (resource: any) => void;
  onFetchResource?: (resource: any) => void;
  onFetchTemplate?: (template: ResourceTemplate) => void;
  modalOpen?: boolean;
}

export function ResourcesTab({
  resources,
  resourceTemplates = [],
  inspectorClient,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  onFetchResource,
  onFetchTemplate,
  modalOpen = false,
}: ResourcesTabProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [resourceContent, setResourceContent] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [shouldFetchResource, setShouldFetchResource] = useState<string | null>(
    null,
  );
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listScrollViewRef = useRef<ScrollViewRef>(null);

  // Combined list: resources first, then templates - memoized to prevent unnecessary recalculations
  const allItems = useMemo(
    () => [
      ...resources.map((r) => ({ type: "resource" as const, data: r })),
      ...resourceTemplates.map((t) => ({ type: "template" as const, data: t })),
    ],
    [resources, resourceTemplates],
  );
  const totalCount = useMemo(
    () => resources.length + resourceTemplates.length,
    [resources.length, resourceTemplates.length],
  );

  // Calculate selectedItem before useInput to avoid stale closure
  const selectedItem = useMemo(
    () => allItems[selectedIndex] || null,
    [allItems, selectedIndex],
  );

  // Handle arrow key navigation when focused
  useInput(
    (input: string, key: Key) => {
      // Handle Enter key to fetch resource (works from both list and details)
      if (
        key.return &&
        selectedItem &&
        inspectorClient &&
        (onFetchResource || onFetchTemplate)
      ) {
        if (selectedItem.type === "resource" && selectedItem.data.uri) {
          // Trigger fetch for regular resource
          setShouldFetchResource(selectedItem.data.uri);
          if (onFetchResource) {
            onFetchResource(selectedItem.data);
          }
        } else if (selectedItem.type === "template" && onFetchTemplate) {
          // Open modal for template
          onFetchTemplate(selectedItem.data);
        }
        return;
      }

      if (focusedPane === "list") {
        // Navigate the list
        if (key.upArrow && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < totalCount - 1) {
          setSelectedIndex(selectedIndex + 1);
        }
        return;
      }

      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && resourceContent && onViewDetails) {
          onViewDetails({ content: resourceContent });
          return;
        }

        // Scroll the details pane using ink-scroll-view
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );

  // Reset scroll when selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  // Auto-scroll list to show selected item
  useEffect(() => {
    if (listScrollViewRef.current && selectedIndex >= 0 && totalCount > 0) {
      listScrollViewRef.current.scrollTo(selectedIndex);
    }
  }, [selectedIndex, totalCount]);

  // Reset selected index when resources array reference changes
  // The component key in App.tsx handles remounting on server change,
  // so this only needs to handle updates for the same server
  const prevResourcesRef = useRef<any[]>(resources);
  useEffect(() => {
    if (prevResourcesRef.current !== resources) {
      setSelectedIndex(0);
      setResourceContent(null);
      setShouldFetchResource(null);
      prevResourcesRef.current = resources;
    }
  }, [resources]);

  const isResource = selectedItem?.type === "resource";
  const isTemplate = selectedItem?.type === "template";
  const selectedResource = isResource ? selectedItem.data : null;
  const selectedTemplate = isTemplate ? selectedItem.data : null;

  // Fetch resource content when shouldFetchResource is set
  useEffect(() => {
    if (!shouldFetchResource || !inspectorClient) return;

    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const response =
          await inspectorClient.readResource(shouldFetchResource);
        setResourceContent(response);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to read resource",
        );
        setResourceContent(null);
      } finally {
        setLoading(false);
        setShouldFetchResource(null);
      }
    };

    fetchContent();
  }, [shouldFetchResource, inspectorClient]);

  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  // Update count when items change - use ref to track previous count and only call when it actually changes
  const prevCountRef = useRef<number>(totalCount);
  useEffect(() => {
    if (prevCountRef.current !== totalCount) {
      prevCountRef.current = totalCount;
      onCountChange?.(totalCount);
    }
  }, [totalCount, onCountChange]);

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Resources and Templates List */}
      <Box
        width={listWidth}
        height={height}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={true}
        flexDirection="column"
        paddingX={1}
      >
        <Box paddingY={1}>
          <Text
            bold
            backgroundColor={focusedPane === "list" ? "yellow" : undefined}
          >
            Resources ({totalCount})
          </Text>
        </Box>
        {error ? (
          <Box paddingY={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : totalCount === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No resources available</Text>
          </Box>
        ) : (
          <ScrollView ref={listScrollViewRef} height={height - 2}>
            {/* Resources Section */}
            {resources.length > 0 && (
              <>
                <Box paddingY={1} flexShrink={0}>
                  <Text bold dimColor>
                    Resources
                  </Text>
                </Box>
                {resources.map((resource, index) => {
                  const isSelected =
                    selectedIndex === index &&
                    selectedItem?.type === "resource";
                  return (
                    <Box key={resource.uri || index} paddingY={0}>
                      <Text>
                        {isSelected ? "▶ " : "  "}
                        {resource.name ||
                          resource.uri ||
                          `Resource ${index + 1}`}
                      </Text>
                    </Box>
                  );
                })}
              </>
            )}

            {/* Resource Templates Section */}
            {resourceTemplates.length > 0 && (
              <>
                {resources.length > 0 && (
                  <Box paddingY={0} flexShrink={0}>
                    <Text> </Text>
                  </Box>
                )}
                <Box paddingY={1} flexShrink={0}>
                  <Text bold dimColor>
                    Resource Templates
                  </Text>
                </Box>
                {resourceTemplates.map((template, index) => {
                  const templateIndex = resources.length + index;
                  const isSelected =
                    selectedIndex === templateIndex &&
                    selectedItem?.type === "template";
                  return (
                    <Box key={template.uriTemplate || index} paddingY={0}>
                      <Text>
                        {isSelected ? "▶ " : "  "}
                        {template.name || `Template ${index + 1}`}
                      </Text>
                    </Box>
                  );
                })}
              </>
            )}
          </ScrollView>
        )}
      </Box>

      {/* Resource Details */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selectedResource ? (
          <>
            {/* Fixed header */}
            <Box flexShrink={0} paddingTop={1}>
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedResource.name || selectedResource.uri}
              </Text>
            </Box>

            {/* Scrollable content area */}
            <ScrollView ref={scrollViewRef} height={height - 3}>
              {/* Description */}
              {selectedResource.description && (
                <>
                  {selectedResource.description
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`desc-${idx}`}
                        marginTop={idx === 0 ? 1 : 0}
                        flexShrink={0}
                      >
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}
                </>
              )}

              {/* URI */}
              {selectedResource.uri && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>URI: {selectedResource.uri}</Text>
                </Box>
              )}

              {/* MIME Type */}
              {selectedResource.mimeType && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>MIME Type: {selectedResource.mimeType}</Text>
                </Box>
              )}

              {/* Resource Content */}
              {loading && (
                <Box marginTop={1} flexShrink={0}>
                  <Text color="yellow">Loading resource content...</Text>
                </Box>
              )}

              {!loading && resourceContent && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Content:</Text>
                  </Box>
                  <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                    <Text dimColor>
                      {JSON.stringify(resourceContent, null, 2)}
                    </Text>
                  </Box>
                </>
              )}

              {!loading && !resourceContent && selectedResource.uri && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>[Enter to Fetch Resource]</Text>
                </Box>
              )}
            </ScrollView>

            {/* Fixed footer - only show when details pane is focused */}
            {focusedPane === "details" && (
              <Box
                flexShrink={0}
                height={1}
                justifyContent="center"
                backgroundColor="gray"
              >
                <Text bold color="white">
                  {resourceContent
                    ? "↑/↓ to scroll, + to zoom"
                    : "Enter to fetch, ↑/↓ to scroll"}
                </Text>
              </Box>
            )}
          </>
        ) : selectedTemplate ? (
          <>
            {/* Fixed header */}
            <Box flexShrink={0} paddingTop={1}>
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedTemplate.name}
              </Text>
            </Box>

            {/* Scrollable content area */}
            <ScrollView ref={scrollViewRef} height={height - 3}>
              {/* Description */}
              {selectedTemplate.description && (
                <>
                  {selectedTemplate.description
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`desc-${idx}`}
                        marginTop={idx === 0 ? 1 : 0}
                        flexShrink={0}
                      >
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}
                </>
              )}

              {/* URI Template */}
              {selectedTemplate.uriTemplate && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>
                    URI Template: {selectedTemplate.uriTemplate}
                  </Text>
                </Box>
              )}

              <Box marginTop={1} flexShrink={0}>
                <Text dimColor>[Enter to Fetch Resource]</Text>
              </Box>
            </ScrollView>

            {/* Fixed footer - only show when details pane is focused */}
            {focusedPane === "details" && (
              <Box
                flexShrink={0}
                height={1}
                justifyContent="center"
                backgroundColor="gray"
              >
                <Text bold color="white">
                  Enter to fetch
                </Text>
              </Box>
            )}
          </>
        ) : (
          <Box paddingY={1} flexShrink={0}>
            <Text dimColor>Select a resource or template to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
