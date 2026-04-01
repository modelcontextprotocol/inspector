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
  searchText: string;
  onSearchChange: (text: string) => void;
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
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectUri,
  onSelectTemplate,
  onUnsubscribeResource,
}: ResourceControlsProps) {
  const filteredResources = resources.filter((r) =>
    r.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  const defaultOpen = [
    ...(filteredResources.length > 0 ? ["resources"] : []),
    ...(templates.length > 0 ? ["templates"] : []),
    ...(subscriptions.length > 0 ? ["subscriptions"] : []),
  ];

  const [openSections, setOpenSections] = useState<string[]>(defaultOpen);
  const maxHeight = panelMaxHeight(openSections.length);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Resources</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
      />
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
          <Accordion.Control disabled={templates.length === 0}>
            {formatSectionCount("Templates", templates.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={maxHeight}>
              <Stack gap="xs">
                {templates.map((template) => (
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
          <Accordion.Control disabled={subscriptions.length === 0}>
            {formatSectionCount("Subscriptions", subscriptions.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <ScrollArea.Autosize mah={maxHeight}>
              <Stack gap="xs">
                {subscriptions.map((sub) => (
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
