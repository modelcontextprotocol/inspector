import React, { useState } from 'react';
import { MCPJamServerConfig, StdioServerDefinition, HttpServerDefinition } from '../lib/serverTypes';
import { ServerConnectionInfo } from '../mcpjamAgent';

interface ServerManagerProps {
  serverConfigs: Record<string, MCPJamServerConfig>;
  serverConnections: ServerConnectionInfo[];
  selectedServerName: string;
  onServerSelect: (serverName: string) => void;
  onAddServer: (name: string, config: MCPJamServerConfig) => void;
  onRemoveServer: (name: string) => void;
  onConnectToServer: (serverName: string) => void;
  onDisconnectFromServer: (serverName: string) => void;
}

export const ServerManager: React.FC<ServerManagerProps> = ({
  serverConfigs,
  serverConnections,
  selectedServerName,
  onServerSelect,
  onAddServer,
  onRemoveServer,
  onConnectToServer,
  onDisconnectFromServer,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerType, setNewServerType] = useState<'stdio' | 'sse' | 'streamable-http'>('stdio');
  const [newServerCommand, setNewServerCommand] = useState('');
  const [newServerArgs, setNewServerArgs] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');

  const handleAddServer = () => {
    if (!newServerName.trim()) return;

    let config: MCPJamServerConfig;
    if (newServerType === 'stdio') {
      config = {
        transportType: 'stdio',
        command: newServerCommand,
        args: newServerArgs.split(' ').filter(arg => arg.trim() !== ''),
        env: {},
      };
    } else {
      config = {
        transportType: newServerType,
        url: new URL(newServerUrl),
      };
    }

    onAddServer(newServerName, config);
    
    // Reset form
    setNewServerName('');
    setNewServerCommand('');
    setNewServerArgs('');
    setNewServerUrl('');
    setShowAddForm(false);
  };

  const getConnectionStatus = (serverName: string) => {
    const connection = serverConnections.find(c => c.name === serverName);
    return connection?.connectionStatus || 'disconnected';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'disconnected': return 'text-gray-600';
      default: return 'text-yellow-600';
    }
  };

  return (
    <div className="p-4 bg-background border-b">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Server Management</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {showAddForm ? 'Cancel' : 'Add Server'}
        </button>
      </div>

      {/* Add Server Form */}
      {showAddForm && (
        <div className="mb-4 p-4 border rounded bg-gray-50">
          <h4 className="font-medium mb-2">Add New Server</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Server Name</label>
              <input
                type="text"
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="my-server"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Transport Type</label>
              <select
                value={newServerType}
                onChange={(e) => setNewServerType(e.target.value as 'stdio' | 'sse' | 'streamable-http')}
                className="w-full p-2 border rounded"
              >
                <option value="stdio">STDIO</option>
                <option value="sse">SSE</option>
                <option value="streamable-http">Streamable HTTP</option>
              </select>
            </div>
            {newServerType === 'stdio' ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Command</label>
                  <input
                    type="text"
                    value={newServerCommand}
                    onChange={(e) => setNewServerCommand(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="python -m my_mcp_server"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Arguments</label>
                  <input
                    type="text"
                    value={newServerArgs}
                    onChange={(e) => setNewServerArgs(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="--port 8080"
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Server URL</label>
                <input
                  type="url"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  className="w-full p-2 border rounded"
                  placeholder="http://localhost:8080"
                />
              </div>
            )}
          </div>
          <button
            onClick={handleAddServer}
            disabled={!newServerName.trim() || (newServerType === 'stdio' ? !newServerCommand : !newServerUrl)}
            className="mt-3 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            Add Server
          </button>
        </div>
      )}

      {/* Server List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium">Select Active Server:</label>
        </div>
        
        <select
          value={selectedServerName}
          onChange={(e) => onServerSelect(e.target.value)}
          className="w-full p-2 border rounded"
        >
          <option value="all">All Servers (View Only)</option>
          {Object.keys(serverConfigs).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {/* Server Status List */}
        <div className="mt-4">
          <h4 className="font-medium mb-2">Server Status:</h4>
          <div className="space-y-2">
            {Object.keys(serverConfigs).map(serverName => {
              const status = getConnectionStatus(serverName);
              const config = serverConfigs[serverName];
              
              return (
                <div key={serverName} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{serverName}</span>
                      <span className={`text-sm ${getStatusColor(status)}`}>
                        ({status})
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {config.transportType === 'stdio' 
                        ? `${(config as StdioServerDefinition).command} ${(config as StdioServerDefinition).args?.join(' ') || ''}`
                        : (config as HttpServerDefinition).url?.toString()
                      }
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {status === 'connected' ? (
                      <button
                        onClick={() => onDisconnectFromServer(serverName)}
                        className="px-2 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => onConnectToServer(serverName)}
                        className="px-2 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        Connect
                      </button>
                    )}
                    {serverName !== 'default' && (
                      <button
                        onClick={() => onRemoveServer(serverName)}
                        className="px-2 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerManager; 