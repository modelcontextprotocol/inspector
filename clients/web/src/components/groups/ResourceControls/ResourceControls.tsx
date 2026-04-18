import { useState } from "react";
import {
  Accordion,
  Group,
  ScrollArea,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { ResourceListItem } from "../ResourceListItem/ResourceListItem";
import { ResourceSubscribedItem } from "../ResourceSubscribedItem/ResourceSubscribedItem";

export interface ResourceControlsProps {
  resources: Resource[];
  templates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
  selectedUri?: string;
  selectedTemplate?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectUri: (uri: string) => void;
  onSelectTemplate: (uriTemplate: string) => void;
  onUnsubscribeResource: (uri: string) => void;
}

function panelMaxHeight(openCount: number): string {
  const n = Math.max(openCount, 1);
  const fixedChrome = 300;
  const perPanelChrome = 20;
  return `calc((100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - ${fixedChrome + perPanelChrome * n}px) / ${n})`;
}

function formatSectionCount(label: string, count: number): string {
  return `${label} (${count})`;
}

export function ResourceControls({
  resources,
  templates,
  subscriptions,
  selectedUri,
  selectedTemplate,
  listChanged,
  onRefreshList,
  onSelectUri,
  onSelectTemplate,
  onUnsubscribeResource,
}: ResourceControlsProps) {
  const [searchText, setSearchText] = useState("");
  const query = searchText.toLowerCase();
  const filteredResources = resources.filter(
    (r) =>
      r.name.toLowerCase().includes(query) ||
      (r.title?.toLowerCase().includes(query) ?? false) ||
      r.uri.toLowerCase().includes(query),
  );
  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(query) ||
      (t.title?.toLowerCase().includes(query) ?? false) ||
      t.uriTemplate.toLowerCase().includes(query),
  );
  const filteredSubscriptions = subscriptions.filter(
    (s) =>
      s.resource.name.toLowerCase().includes(query) ||
      s.resource.uri.toLowerCase().includes(query),
  );

  const defaultOpen = [
    ...(filteredResources.length > 0 ? ["resources"] : []),
    ...(filteredTemplates.length > 0 ? ["templates"] : []),
    ...(filteredSubscriptions.length > 0 ? ["subscriptions"] : []),
  ];

  const allSections = ["resources", "templates", "subscriptions"];
  const [openSections, setOpenSections] = useState<string[]>(defaultOpen);
  const allExpanded = openSections.length === allSections.length;
  const maxHeight = panelMaxHeight(openSections.length);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Resources</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.currentTarget.value)}
        />
        <ListToggle
          compact={!allExpanded}
          onToggle={() => setOpenSections(allExpanded ? [] : [...allSections])}
        />
      </Group>
      <Accordion multiple value={openSections} onChange={setOpenSections}>
        <Accordion.Item value="resources">
          <Accordion.Control disabled={filteredResources.length === 0}>
            {formatSectionCount("URIs", filteredResources.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={maxHeight}>
              <Stack gap="xs">
                {filteredResources.map((resource) => (
                  <ResourceListItem
                    key={resource.uri}
                    resource={resource}
                    selected={resource.uri === selectedUri}
                    onClick={() => {
                      if (resource.uri !== selectedUri)
                        onSelectUri(resource.uri);
                    }}
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="templates">
          <Accordion.Control disabled={filteredTemplates.length === 0}>
            {formatSectionCount("Templates", filteredTemplates.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={maxHeight}>
              <Stack gap="xs">
                {filteredTemplates.map((template) => (
                  <ResourceListItem
                    key={template.uriTemplate}
                    resource={template}
                    selected={template.uriTemplate === selectedTemplate}
                    onClick={() => {
                      if (template.uriTemplate !== selectedTemplate)
                        onSelectTemplate(template.uriTemplate);
                    }}
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="subscriptions">
          <Accordion.Control disabled={filteredSubscriptions.length === 0}>
            {formatSectionCount("Subscriptions", filteredSubscriptions.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={maxHeight}>
              <Stack gap="xs">
                {filteredSubscriptions.map((sub) => (
                  <ResourceSubscribedItem
                    key={sub.resource.uri}
                    subscription={sub}
                    onUnsubscribe={() =>
                      onUnsubscribeResource(sub.resource.uri)
                    }
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
