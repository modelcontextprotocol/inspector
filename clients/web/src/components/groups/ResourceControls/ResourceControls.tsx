import {
  Accordion,
  CloseButton,
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
  selectedTemplateUri?: string;
  // Search text + accordion open-sections are controlled by the parent (App,
  // via ResourcesScreen) so they persist across tab navigation within a live
  // session — see #1417. `openSections` is optional: when undefined the
  // accordion falls back to the `compact`-derived default below.
  searchText?: string;
  openSections?: string[];
  listChanged: boolean;
  onRefreshList: () => void;
  onSearchChange: (value: string) => void;
  onOpenSectionsChange: (value: string[]) => void;
  onSelectUri: (uri: string) => void;
  onSelectTemplate: (uriTemplate: string) => void;
  onUnsubscribeResource: (uri: string) => void;
  /**
   * Persisted preference for the ListToggle. Seeds initial accordion state
   * (when `openSections` is undefined); the user can still toggle individual
   * sections during a session without affecting this value. Only an explicit
   * ListToggle click updates it.
   */
  compact: boolean;
  onCompactChange: (next: boolean) => void;
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
  selectedTemplateUri,
  searchText = "",
  openSections: controlledOpenSections,
  listChanged,
  onRefreshList,
  onSearchChange,
  onOpenSectionsChange,
  onSelectUri,
  onSelectTemplate,
  onUnsubscribeResource,
  compact: initialCompact,
  onCompactChange,
}: ResourceControlsProps) {
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
      (s.resource.title?.toLowerCase().includes(query) ?? false) ||
      s.resource.uri.toLowerCase().includes(query),
  );

  const allSections = ["resources", "templates", "subscriptions"];
  // Open-sections is parent-controlled (persists across navigation). When the
  // parent hasn't set it yet (undefined), fall back to the persisted `compact`
  // preference: empty when last left compact, all three open when expanded.
  // Per-section accordion clicks update the lifted value but don't change the
  // persisted preference.
  const openSections =
    controlledOpenSections ?? (initialCompact ? [] : [...allSections]);
  const allExpanded = openSections.length === allSections.length;
  const maxHeight = panelMaxHeight(openSections.length);

  function handleToggleList() {
    // Compute the next compact value from what the click will produce so a
    // half-open accordion (user toggled a single section) still persists the
    // right preference: clicking "expand all" should record `compact=false`
    // even if the visible state was already partially expanded.
    const nextCompact = allExpanded;
    onOpenSectionsChange(nextCompact ? [] : [...allSections]);
    onCompactChange(nextCompact);
  }

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
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          rightSectionPointerEvents="auto"
          rightSection={
            searchText ? (
              <CloseButton
                aria-label="Clear"
                onClick={() => onSearchChange("")}
              />
            ) : null
          }
        />
        <ListToggle compact={!allExpanded} onToggle={handleToggleList} />
      </Group>
      <Accordion multiple value={openSections} onChange={onOpenSectionsChange}>
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
                    selected={template.uriTemplate === selectedTemplateUri}
                    onClick={() => {
                      if (template.uriTemplate !== selectedTemplateUri)
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
