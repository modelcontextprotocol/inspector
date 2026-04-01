import { useState } from "react";
import {
  Accordion,
  Group,
  ScrollArea,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { ResourceListItem } from "../ResourceListItem/ResourceListItem";
import { ResourceSubscribedItem } from "../ResourceSubscribedItem/ResourceSubscribedItem";
import type {
  ResourceItem,
  TemplateListItem,
  SubscriptionItem,
} from "../../screens/ResourcesScreen/ResourcesScreen";

export interface ResourceControlsProps {
  resources: ResourceItem[];
  templates: TemplateListItem[];
  subscriptions: SubscriptionItem[];
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectUri: (uri: string) => void;
  onSelectTemplate: (uriTemplate: string) => void;
  onUnsubscribeResource: (uri: string) => void;
}

// Available height for each accordion panel's scroll area.
// Subtracts: AppShell extra padding (md*2), screen padding (xl*2, already in calc),
// card padding (2*lg=40), title+search+gaps (~84), 3 accordion controls (~144),
// and per-panel accordion padding (~20px each).
function panelMaxHeight(openCount: number): string {
  const n = Math.max(openCount, 1);
  const fixedChrome = 300;
  const perPanelChrome = 20;
  return `calc((100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - ${fixedChrome + perPanelChrome * n}px) / ${n})`;
}

function formatSectionCount(label: string, count: number): string {
  return `${label} (${count})`;
}

function templateDisplayName(item: TemplateListItem): string {
  return item.title ?? item.name;
}

export function ResourceControls({
  resources,
  templates,
  subscriptions,
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
      r.uri.toLowerCase().includes(query),
  );
  const filteredTemplates = templates.filter(
    (t) =>
      templateDisplayName(t).toLowerCase().includes(query) ||
      t.uriTemplate.toLowerCase().includes(query),
  );
  const filteredSubscriptions = subscriptions.filter(
    (s) =>
      s.name.toLowerCase().includes(query) ||
      s.uri.toLowerCase().includes(query),
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
        <ListToggle
          compact={!allExpanded}
          onToggle={() => setOpenSections(allExpanded ? [] : [...allSections])}
        />
        <TextInput
          flex={1}
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.currentTarget.value)}
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
                    name={resource.name}
                    uri={resource.uri}
                    annotations={resource.annotations}
                    selected={resource.selected}
                    onClick={() => onSelectUri(resource.uri)}
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
                    name={templateDisplayName(template)}
                    uri={template.uriTemplate}
                    selected={template.selected}
                    onClick={() => onSelectTemplate(template.uriTemplate)}
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
                    key={sub.name}
                    name={sub.name}
                    lastUpdated={sub.lastUpdated}
                    onUnsubscribe={() => onUnsubscribeResource(sub.uri)}
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
