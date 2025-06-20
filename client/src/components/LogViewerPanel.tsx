import React, { useState } from 'react';
import LogViewer from './LogViewer';

interface LogViewerPanelProps {
  serverNames: string[];
  initialServerName?: string;
}

const LogViewerPanel: React.FC<LogViewerPanelProps> = ({ serverNames, initialServerName }) => {
  const [selectedServer, setSelectedServer] = useState(initialServerName || (serverNames[0] || ''));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ marginRight: 8, fontWeight: 'bold' }}>Select log:</label>
        <select
          value={selectedServer}
          onChange={e => setSelectedServer(e.target.value)}
          style={{ padding: 4, fontSize: 14 }}
        >
          {serverNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogViewer serverName={selectedServer} />
      </div>
    </div>
  );
};

export default LogViewerPanel; 