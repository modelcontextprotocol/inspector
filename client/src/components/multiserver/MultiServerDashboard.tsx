import React from "react";
import { ServerList } from "./ServerList";
import { AddServerForm } from "./AddServerForm";
import { ServerConfigModal } from "./ServerConfigModal";
import { ServerSpecificTabs } from "./ServerSpecificTabs";
import MultiServerHistoryAndNotifications from "./MultiServerHistoryAndNotifications";
import { ErrorSummaryCard } from "./ErrorSummaryCard";
import { useMultiServer } from "./hooks/useMultiServer";
import { useMultiServerErrors } from "./hooks/useMultiServerErrors";
import {
  ServerConfig,
  CreateServerRequest,
  UpdateServerRequest,
} from "./types/multiserver";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Server,
  Plus,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowLeft,
  History,
} from "lucide-react";

interface MultiServerDashboardProps {
  className?: string;
  onCurrentServerChange?: (
    serverId: string | null,
    serverName: string | null,
    serverStatus: string | null,
  ) => void;
}

export const MultiServerDashboard: React.FC<MultiServerDashboardProps> = ({
  className = "",
  onCurrentServerChange,
}) => {
  const {
    servers,
    statuses,
    selectedServerId,
    isLoading,
    error,
    addServer,
    updateServer,
    deleteServer,
    connectToServer,
    disconnectFromServer,
    selectServer,
    getServerStatus,
    getServerConnection,
  } = useMultiServer();

  // Error management hook
  const { errorSummaries, totalErrorCount, clearAllErrors } =
    useMultiServerErrors();

  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editingServer, setEditingServer] = React.useState<ServerConfig | null>(
    null,
  );
  const [activeTab, setActiveTab] = React.useState("overview");
  const [viewingServer, setViewingServer] = React.useState<ServerConfig | null>(
    null,
  );

  // Notify parent about current server changes (moved to useEffect to avoid setState during render)
  React.useEffect(() => {
    if (onCurrentServerChange) {
      if (viewingServer) {
        const serverStatus = getServerStatus(viewingServer.id);
        onCurrentServerChange(
          viewingServer.id,
          viewingServer.name,
          serverStatus.status,
        );
      } else {
        // Clear current server when going back to dashboard
        onCurrentServerChange(null, null, null);
      }
    }
  }, [viewingServer, onCurrentServerChange, getServerStatus]);

  // Calculate statistics
  const stats = React.useMemo(() => {
    const total = servers.length;
    const connected = servers.filter(
      (s) => statuses.get(s.id)?.status === "connected",
    ).length;
    const connecting = servers.filter(
      (s) => statuses.get(s.id)?.status === "connecting",
    ).length;
    const errors = servers.filter(
      (s) => statuses.get(s.id)?.status === "error",
    ).length;
    const disconnected = total - connected - connecting - errors;

    return { total, connected, connecting, errors, disconnected };
  }, [servers, statuses]);

  const handleAddServer = async (config: CreateServerRequest) => {
    try {
      await addServer(config);
      setShowAddForm(false);
    } catch (error) {
      // Error is handled by the hook
      throw error;
    }
  };

  const handleUpdateServer = async (
    serverId: string,
    config: UpdateServerRequest,
  ) => {
    try {
      await updateServer(serverId, config);
      setEditingServer(null);
    } catch (error) {
      // Error is handled by the hook
      throw error;
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (
      window.confirm(
        "Are you sure you want to delete this server? This action cannot be undone.",
      )
    ) {
      try {
        await deleteServer(serverId);
      } catch (error) {
        // Error is handled by the hook
      }
    }
  };

  const handleEditServer = (server: ServerConfig) => {
    setEditingServer(server);
  };

  const handleViewServer = (server: ServerConfig) => {
    setViewingServer(server);
  };

  const handleViewServerErrors = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (server) {
      handleViewServer(server);
    }
  };

  const handleBackToDashboard = () => {
    setViewingServer(null);
    setShowAddForm(false);
    // Note: onCurrentServerChange will be called via useEffect when viewingServer changes to null
  };

  const handleConnect = async (serverId: string) => {
    try {
      await connectToServer(serverId);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const handleDisconnect = async (serverId: string) => {
    try {
      await disconnectFromServer(serverId);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  if (viewingServer) {
    const serverStatus = getServerStatus(viewingServer.id);
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex items-center gap-2 mb-4 p-4 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToDashboard}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <ServerSpecificTabs
            server={viewingServer}
            serverStatus={serverStatus}
            serverConnection={getServerConnection(viewingServer.id)}
            onConnect={() => handleConnect(viewingServer.id)}
            onDisconnect={() => handleDisconnect(viewingServer.id)}
          />
        </div>
      </div>
    );
  }

  if (showAddForm) {
    return (
      <div className={`space-y-4 p-2 md:p-4 lg:p-6 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={handleBackToDashboard}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        <AddServerForm
          onSubmit={handleAddServer}
          onCancel={handleBackToDashboard}
        />
      </div>
    );
  }

  return (
    <div className={`space-y-6 p-4 md:p-6 lg:p-8 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Server className="h-8 w-8" />
            Multi-Server Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage and monitor multiple MCP server connections
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Servers</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Configured servers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Connected</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats.connected}
            </div>
            <p className="text-xs text-muted-foreground">Active connections</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Connecting</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.connecting}
            </div>
            <p className="text-xs text-muted-foreground">In progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats.errors}
            </div>
            <p className="text-xs text-muted-foreground">Failed connections</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="servers">Servers</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Error Summary Card - Full Width */}
          <ErrorSummaryCard
            errorSummaries={errorSummaries}
            totalErrorCount={totalErrorCount}
            onViewServerErrors={handleViewServerErrors}
            onClearAllErrors={clearAllErrors}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common tasks and operations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => setShowAddForm(true)}
                  className="w-full justify-start"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add New Server
                </Button>

                {stats.connected > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab("servers")}
                    className="w-full justify-start"
                  >
                    <Activity className="mr-2 h-4 w-4" />
                    View Connected Servers
                  </Button>
                )}

                {stats.errors > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab("monitoring")}
                    className="w-full justify-start"
                  >
                    <AlertCircle className="mr-2 h-4 w-4" />
                    Check Error Details
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Server Status */}
            <Card>
              <CardHeader>
                <CardTitle>Server Status</CardTitle>
                <CardDescription>Current status of all servers</CardDescription>
              </CardHeader>
              <CardContent>
                {servers.length === 0 ? (
                  <div className="text-center py-6">
                    <Server className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">
                      No servers configured yet
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {servers.slice(0, 5).map((server) => {
                      const status = getServerStatus(server.id);
                      return (
                        <div
                          key={server.id}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {server.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {server.transportType}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant={
                              status.status === "connected"
                                ? "success"
                                : status.status === "connecting"
                                  ? "warning"
                                  : status.status === "error"
                                    ? "error"
                                    : "secondary"
                            }
                          >
                            {status.status}
                          </Badge>
                        </div>
                      );
                    })}
                    {servers.length > 5 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveTab("servers")}
                        className="w-full"
                      >
                        View all {servers.length} servers
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="servers">
          <ServerList
            servers={servers}
            statuses={statuses}
            selectedServerId={selectedServerId}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onEdit={handleEditServer}
            onDelete={handleDeleteServer}
            onSelect={selectServer}
            onView={handleViewServer}
            onAddServer={() => setShowAddForm(true)}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Server Monitoring</CardTitle>
              <CardDescription>
                Monitor server health and connection status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {servers.length === 0 ? (
                <div className="text-center py-6">
                  <Activity className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">
                    No servers to monitor
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {servers.map((server) => {
                    const status = getServerStatus(server.id);
                    return (
                      <div key={server.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{server.name}</h4>
                          <Badge
                            variant={
                              status.status === "connected"
                                ? "success"
                                : status.status === "connecting"
                                  ? "warning"
                                  : status.status === "error"
                                    ? "error"
                                    : "secondary"
                            }
                          >
                            {status.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Transport: {server.transportType}</p>
                          {status.lastConnected && (
                            <p>
                              Last connected:{" "}
                              {new Date(status.lastConnected).toLocaleString()}
                            </p>
                          )}
                          {status.lastError && (
                            <p className="text-destructive">
                              Error: {status.lastError}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <MultiServerHistoryAndNotifications />
        </TabsContent>
      </Tabs>

      {/* Edit Server Modal */}
      <ServerConfigModal
        server={editingServer}
        isOpen={editingServer !== null}
        onClose={() => setEditingServer(null)}
        onSave={handleUpdateServer}
        isSaving={isLoading}
      />
    </div>
  );
};
