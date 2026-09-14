import { Alert, Code, List, ScrollArea, Text } from "@mantine/core";
import type { MalformedListItem } from "@inspector/core/mcp";

export interface MalformedItemsWarningProps {
  /**
   * Every malformed entry the client is currently reporting, across all list
   * methods — pass the hook's set straight through; the component selects its
   * own by {@link method}.
   */
  items: MalformedListItem[];
  /** The list method this panel renders, e.g. `"resources/templates/list"`. */
  method: string;
  /** What the entries are, for the alert title — e.g. "resource templates". */
  what: string;
}

// Yellow, not red: unlike ListLoadError this is not a failure — the list DID
// load and is rendered below. It reports what the server sent that the
// Inspector could not accept.
const WarningAlert = Alert.withProps({
  color: "yellow",
  variant: "light",
});

// The entry list stays compact; the reasons are the payload, so they get the
// monospace treatment while the labels stay in body type.
const EntryList = List.withProps({
  size: "xs",
  spacing: 4,
  withPadding: true,
});

const EntryReason = Code.withProps({
  variant: "wrapping",
});

// A server can be wrong about many entries at once; cap the height so a badly
// broken list can't push the list itself off the sidebar.
const EntryScroll = ScrollArea.withProps({
  mah: 180,
  type: "auto",
});

const SummaryText = Text.withProps({
  size: "xs",
  mb: 4,
});

// The entry's identity, emphasized against its monospaced reason.
const EntryLabel = Text.withProps({
  component: "span",
  size: "xs",
  fw: 600,
});

/** `label` when the entry had one, else its position in the response. */
function describeEntry(item: MalformedListItem): string {
  return item.label ?? `entry ${item.index}`;
}

/**
 * "Some entries were dropped" — the visible half of the #1909 salvage.
 *
 * The client keeps the valid entries of a list whose result failed schema
 * validation, rather than losing the whole list to one bad entry. Dropping them
 * silently would trade one lie for another, so what was dropped, and why, is
 * reported here beside the list that rendered without them.
 */
export function MalformedItemsWarning({
  items,
  method,
  what,
}: MalformedItemsWarningProps) {
  const mine = items.filter((item) => item.method === method);
  if (mine.length === 0) return null;

  return (
    <WarningAlert
      title={`${mine.length} malformed ${
        mine.length === 1 ? "entry" : "entries"
      } dropped`}
    >
      <SummaryText>
        The server returned {what} that don&apos;t match the MCP schema. The
        rest of the list is shown below.
      </SummaryText>
      <EntryScroll>
        <EntryList>
          {mine.map((item) => (
            <List.Item key={`${item.method}:${item.index}`}>
              <EntryLabel>{describeEntry(item)}</EntryLabel>{" "}
              <EntryReason>{item.reason}</EntryReason>
            </List.Item>
          ))}
        </EntryList>
      </EntryScroll>
    </WarningAlert>
  );
}
