import {
  Alert,
  Code,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { ServerCard } from "../../groups/ServerCard/ServerCard";
import { ServerListControls } from "../../groups/ServerListControls/ServerListControls";
import { SortableServerCard } from "../../groups/SortableServerCard/SortableServerCard";
import {
  buildReorderAnnouncements,
  makeServerDragEndHandler,
} from "./serverReorder";

export interface ServerListScreenProps {
  servers: ServerEntry[];
  /**
   * Whether the server list is writable (catalog) or read-only (a `--config`
   * session file / ad-hoc launch). When false, all catalog mutation controls
   * (add, edit, clone, remove, reorder, settings) are hidden and a read-only
   * banner is shown. Defaults to true.
   */
  writable?: boolean;
  /** Id of the server the wiring layer treats as active (drives card dimming). */
  activeServer?: string;
  /**
   * Id of the server whose last connection attempt failed (#1621). Its card
   * draws a red border until another server is connected or attempted.
   */
  erroredServerId?: string;
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
  /** Download the current server list as a canonical `mcp.json` file. */
  onExport: () => void;
  onToggleConnection: (id: string) => void;
  onConnectionInfo: (id: string) => void;
  onSettings: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onRemove: (id: string) => void;
  /**
   * Persist a new server ordering. Receives the complete set of server ids in
   * the desired order. Omit to render the list without reorder affordances.
   */
  onReorder?: (orderedIds: string[]) => void;
  /** Ids of freshly-added servers to highlight (animated border); the first is
   *  also scrolled into view. */
  highlightedServerIds?: string[];
  /** Clears the highlight for a server (called when its card is clicked). */
  onClearHighlight?: (id: string) => void;
  compact: boolean;
  onToggleCompact: () => void;
}

const PageContainer = Stack.withProps({
  p: "xl",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function ServerListScreen({
  servers,
  writable = true,
  activeServer,
  erroredServerId,
  onAddManually,
  onImportConfig,
  onImportServerJson,
  onExport,
  onToggleConnection,
  onConnectionInfo,
  onSettings,
  onEdit,
  onClone,
  onRemove,
  onReorder,
  highlightedServerIds,
  onClearHighlight,
  compact,
  onToggleCompact,
}: ServerListScreenProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = servers.map((s) => s.id);

  // `reorderable` only when a persistence callback is wired AND the list is
  // writable. Without it we render plain `ServerCard`s (no grip, no DndContext)
  // so the screen stays usable as a pure display — the SortableServerCard's
  // grip would otherwise be a dead affordance (and reorder is a catalog write
  // the backend rejects in a read-only session).
  const reorderable = onReorder !== undefined && writable;

  // Built only when reorderable — the drag-end handler and the fresh
  // announcements object (four closures) are otherwise allocated every render
  // for nothing.
  const handleDragEnd = reorderable
    ? makeServerDragEndHandler(servers, onReorder)
    : undefined;
  const announcements = reorderable
    ? buildReorderAnnouncements(servers)
    : undefined;

  // Only the first highlighted card (in display order) scrolls into view so a
  // batch import jumps to the start of the batch instead of fighting over the
  // viewport.
  const firstHighlightedId = servers.find((s) =>
    highlightedServerIds?.includes(s.id),
  )?.id;

  const cardProps = (server: ServerEntry) => ({
    compact,
    writable,
    activeServer,
    onToggleConnection,
    onConnectionInfo,
    onSettings,
    onEdit,
    onClone,
    onRemove,
    highlighted: highlightedServerIds?.includes(server.id) ?? false,
    errored: server.id === erroredServerId,
    scrollOnHighlight: server.id === firstHighlightedId,
    onClearHighlight: onClearHighlight
      ? () => onClearHighlight(server.id)
      : undefined,
    ...server,
  });

  const grid = (
    <SimpleGrid
      // Container queries (not viewport) so column count tracks the actual
      // space the grid occupies. The 2- and 3-column thresholds (1040px /
      // 1560px) keep each card ≥ ~505px wide at the switch point: container =
      // N·card + (N−1)·gap with gap = lg spacing (20px), i.e. 1040 = 2·510+20
      // and 1560 = 3·507+40. Below ~500px a connected card's action row
      // (Clone/Edit/Remove + Connection Info/Settings, ~440px with padding)
      // wraps and stacks, making that card taller than its neighbours; dropping
      // to fewer, wider columns instead keeps every card the same height.
      // (#1528)
      type="container"
      cols={{ base: 1, "1040px": 2, "1560px": 3 }}
      spacing="lg"
      className="grid-align-start"
    >
      {servers.map((server) =>
        reorderable ? (
          <SortableServerCard key={server.id} {...cardProps(server)} />
        ) : (
          <ServerCard key={server.id} {...cardProps(server)} />
        ),
      )}
    </SimpleGrid>
  );

  return (
    <PageContainer>
      {!writable && (
        <Alert color="gray" variant="light" title="Read-only session">
          This server list was launched with <Code>--config</Code> or an ad-hoc
          server and can't be edited here. Changes won't be saved. Use{" "}
          <Code>--catalog</Code> (or no flag) to manage a writable catalog.
        </Alert>
      )}
      <ServerListControls
        serverCount={servers.length}
        compact={compact}
        writable={writable}
        onToggleList={onToggleCompact}
        onAddManually={onAddManually}
        onImportConfig={onImportConfig}
        onImportServerJson={onImportServerJson}
        onExport={onExport}
      />

      <ScrollArea.Autosize
        mah="calc(100dvh - var(--app-shell-header-height, 60px) - var(--mantine-spacing-xl) * 2 - 60px)"
        // Same scrollbar treatment as the History/Network/Logging list panels
        // (#1474): reserve a gutter so the bar never overlays the right edge of
        // the server cards (occluding their action icons / status badges), and
        // only show it while actively scrolling rather than popping in on hover.
        type="scroll"
        offsetScrollbars
      >
        {servers.length === 0 ? (
          <EmptyState>
            No servers configured. Add a server to get started.
          </EmptyState>
        ) : reorderable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              {grid}
            </SortableContext>
          </DndContext>
        ) : (
          grid
        )}
      </ScrollArea.Autosize>
    </PageContainer>
  );
}
