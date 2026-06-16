import { Alert, ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
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
    ...server,
  });

  const grid = (
    <SimpleGrid
      cols={{ base: 1, sm: 2, lg: 3 }}
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
          This server list was launched with <code>--config</code> or an ad-hoc
          server and can't be edited here. Changes won't be saved. Use{" "}
          <code>--catalog</code> (or no flag) to manage a writable catalog.
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
