import { Accordion, Group, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import { RiArrowRightSLine } from "react-icons/ri";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
} from "@modelcontextprotocol/client";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { ResourceListItem } from "../ResourceListItem/ResourceListItem";
import { ResourceSubscribedItem } from "../ResourceSubscribedItem/ResourceSubscribedItem";

export interface ResourceControlsProps {
  resources: Resource[];
  templates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
  /**
   * Whether the connected server advertises the `resources.subscribe`
   * capability. When false, the Subscriptions accordion section is hidden
   * entirely. Defaults to true so the section renders unless a caller
   * explicitly marks subscriptions unsupported.
   */
  subscriptionsSupported?: boolean;
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

function formatSectionCount(label: string, count: number): string {
  return `${label} (${count})`;
}

// Per-section flex for the full-height accordion. Open sections share the
// remaining height; `flex-shrink` is weighted by item count (so a long section
// gives up space to shorter ones before they have to scroll) and `flex-grow` is
// 0 so nothing expands — or scrolls — until the combined content overflows the
// panel. Closed/empty sections stay at their header height (#1462).
function sectionFlex(open: boolean, count: number): string {
  return open && count > 0 ? `0 ${count} auto` : "0 0 auto";
}

export function ResourceControls({
  resources,
  templates,
  subscriptions,
  subscriptionsSupported = true,
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

  // Subscriptions are only meaningful when the server advertises the
  // `resources.subscribe` capability; otherwise the section is omitted
  // entirely (no header, no panel) — see #1478.
  const allSections = subscriptionsSupported
    ? ["resources", "templates", "subscriptions"]
    : ["resources", "templates"];
  // Open-sections is parent-controlled (persists across navigation). When the
  // parent hasn't set it yet (undefined), fall back to the persisted `compact`
  // preference: empty when last left compact, all sections open when expanded.
  // Per-section accordion clicks update the lifted value but don't change the
  // persisted preference.
  const openSections =
    controlledOpenSections ?? (initialCompact ? [] : [...allSections]);
  // Persisted open-sections may still carry "subscriptions" from a prior
  // subscription-capable session, so compare only the sections we actually
  // render when deciding whether everything is expanded.
  const allExpanded =
    openSections.filter((section) => allSections.includes(section)).length ===
    allSections.length;

  // Empty sections have a disabled control and nothing to show, so keep them
  // out of the accordion's open set — they render collapsed (chevron points
  // right) rather than as an open-but-empty panel (#1462). `openSections` still
  // tracks the user's intent (and seeds the ListToggle), so a section re-opens
  // on its own once it has items again.
  const sectionItemCounts: Record<string, number> = {
    resources: filteredResources.length,
    templates: filteredTemplates.length,
    subscriptions: filteredSubscriptions.length,
  };
  const visibleOpenSections = openSections.filter(
    (section) =>
      allSections.includes(section) && (sectionItemCounts[section] ?? 0) > 0,
  );
  // Open-in-intent but currently empty (so excluded from the accordion's
  // `value`). Mantine derives the next open-array by toggling the clicked
  // section against the `value` we hand it, which omits these — so without
  // merging them back, toggling any populated section would silently drop an
  // empty section's intent and it wouldn't reappear once it has items again.
  // Restricted to `allSections` so a stale "subscriptions" entry persisted from
  // a prior subscription-capable session isn't perpetually re-appended once the
  // section is no longer rendered — it's dropped from persisted state instead.
  const intendedButEmptySections = openSections.filter(
    (section) =>
      allSections.includes(section) && !visibleOpenSections.includes(section),
  );
  function handleOpenSectionsChange(next: string[]) {
    // Safe to append unconditionally: empty-section controls are `disabled`, so
    // the user can never toggle one and `next` never contains an empty section
    // — no double-add, and a section the user just closed can't be resurrected.
    onOpenSectionsChange([...next, ...intendedButEmptySections]);
  }

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
    // Fills the full-height `sidebar` Card (flex column) so the scroll region
    // below can claim the remaining space; `mih: 0` lets that child shrink and
    // scroll instead of overflowing the card (#1462).
    <Stack gap="sm" flex={1} mih={0}>
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
              <ClearButton onClick={() => onSearchChange("")} />
            ) : null
          }
        />
        <ListToggle compact={!allExpanded} onToggle={handleToggleList} />
      </Group>
      <Accordion
        multiple
        variant="disclosure"
        chevron={<RiArrowRightSLine />}
        value={visibleOpenSections}
        onChange={handleOpenSectionsChange}
        flex={1}
        mih={0}
        // Disable Mantine's panel height animation: its Collapse drives the
        // open/close via an inline `height` that briefly jumps the panel to its
        // full natural height, fighting the flex sizing (the panels are
        // flex-distributed and scroll). With it off, flex controls the height
        // cleanly. The chevron still rotates smoothly (CSS, in App.css). #1462
        transitionDuration={0}
      >
        <Accordion.Item
          value="resources"
          flex={sectionFlex(
            visibleOpenSections.includes("resources"),
            filteredResources.length,
          )}
        >
          <Accordion.Control disabled={filteredResources.length === 0}>
            {formatSectionCount("URIs", filteredResources.length)}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {filteredResources.map((resource) => (
                <ResourceListItem
                  key={resource.uri}
                  resource={resource}
                  selected={resource.uri === selectedUri}
                  onClick={() => {
                    if (resource.uri !== selectedUri) onSelectUri(resource.uri);
                  }}
                />
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item
          value="templates"
          flex={sectionFlex(
            visibleOpenSections.includes("templates"),
            filteredTemplates.length,
          )}
        >
          <Accordion.Control disabled={filteredTemplates.length === 0}>
            {formatSectionCount("Templates", filteredTemplates.length)}
          </Accordion.Control>
          <Accordion.Panel>
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
          </Accordion.Panel>
        </Accordion.Item>

        {subscriptionsSupported && (
          <Accordion.Item
            value="subscriptions"
            flex={sectionFlex(
              visibleOpenSections.includes("subscriptions"),
              filteredSubscriptions.length,
            )}
          >
            <Accordion.Control disabled={filteredSubscriptions.length === 0}>
              {formatSectionCount(
                "Subscriptions",
                filteredSubscriptions.length,
              )}
            </Accordion.Control>
            <Accordion.Panel>
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
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </Stack>
  );
}
