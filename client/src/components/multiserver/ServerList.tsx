import React from "react";
import { ServerConfig, ServerStatus } from "./types/multiserver";
import { ServerCard } from "./ServerCard";
import { Button } from "../ui/button";
import { Plus, Search } from "lucide-react";
import { Input } from "../ui/input";

interface ServerListProps {
  servers: ServerConfig[];
  statuses: Map<string, ServerStatus>;
  selectedServerId: string | null;
  onConnect: (serverId: string) => void;
  onDisconnect: (serverId: string) => void;
  onEdit: (server: ServerConfig) => void;
  onDelete: (serverId: string) => void;
  onSelect: (serverId: string) => void;
  onView: (server: ServerConfig) => void;
  onAddServer: () => void;
  isLoading?: boolean;
  className?: string;
}

export const ServerList: React.FC<ServerListProps> = ({
  servers,
  statuses,
  selectedServerId,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onSelect,
  onView,
  onAddServer,
  isLoading = false,
  className = "",
}) => {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "status" | "type">(
    "name",
  );

  const filteredServers = React.useMemo(() => {
    let filtered = servers.filter(
      (server) =>
        server.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (server.description?.toLowerCase().includes(searchTerm.toLowerCase()) ??
          false),
    );

    // Sort servers
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "status":
          const statusA = statuses.get(a.id)?.status || "disconnected";
          const statusB = statuses.get(b.id)?.status || "disconnected";
          return statusA.localeCompare(statusB);
        case "type":
          return a.transportType.localeCompare(b.transportType);
        default:
          return 0;
      }
    });

    return filtered;
  }, [servers, searchTerm, sortBy, statuses]);

  const getServerStatus = (serverId: string): ServerStatus => {
    return (
      statuses.get(serverId) || {
        id: serverId,
        status: "disconnected",
      }
    );
  };

  const connectedCount = servers.filter(
    (server) => statuses.get(server.id)?.status === "connected",
  ).length;

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Servers</h2>
          <Button onClick={onAddServer} disabled>
            <Plus className="mr-2 h-4 w-4" />
            Add Server
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Servers</h2>
          <p className="text-sm text-muted-foreground">
            {servers.length} server{servers.length !== 1 ? "s" : ""} configured
            {connectedCount > 0 && (
              <span className="ml-2 text-green-600">
                • {connectedCount} connected
              </span>
            )}
          </p>
        </div>
        <Button onClick={onAddServer}>
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>

      {/* Search and Filter */}
      {servers.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search servers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "name" | "status" | "type")
            }
            className="px-3 py-2 border border-input bg-background rounded-md text-sm"
          >
            <option value="name">Sort by Name</option>
            <option value="status">Sort by Status</option>
            <option value="type">Sort by Type</option>
          </select>
        </div>
      )}

      {/* Server Grid */}
      {filteredServers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredServers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              status={getServerStatus(server.id)}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onEdit={onEdit}
              onDelete={onDelete}
              onSelect={onSelect}
              onView={onView}
              isSelected={selectedServerId === server.id}
            />
          ))}
        </div>
      ) : servers.length === 0 ? (
        /* Empty State */
        <div className="text-center py-12">
          <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
            <Plus className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No servers configured</h3>
          <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
            Get started by adding your first MCP server configuration. You can
            connect to both stdio and HTTP-based servers.
          </p>
          <Button onClick={onAddServer}>
            <Plus className="mr-2 h-4 w-4" />
            Add Your First Server
          </Button>
        </div>
      ) : (
        /* No Search Results */
        <div className="text-center py-8">
          <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No servers found</h3>
          <p className="text-muted-foreground mb-4">
            No servers match your search criteria. Try adjusting your search
            terms.
          </p>
          <Button variant="outline" onClick={() => setSearchTerm("")}>
            Clear Search
          </Button>
        </div>
      )}
    </div>
  );
};
