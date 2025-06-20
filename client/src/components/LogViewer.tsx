import React, { useEffect, useState } from 'react';

interface LogViewerProps {
  serverName: string;
}

const LogViewer: React.FC<LogViewerProps> = ({ serverName }) => {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(serverName)}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const text = await res.text();
      setLog(text);
    } catch (err: any) {
      setError(err.message || 'Failed to load log');
      setLog('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverName]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', marginRight: 8 }}>Log for: {serverName}</span>
        <button onClick={fetchLog} disabled={loading} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div style={{ color: 'red' }}>{error}</div>
      ) : (
        <pre
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#18181b',
            color: '#f4f4f5',
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {log || 'No log entries.'}
        </pre>
      )}
    </div>
  );
};

export default LogViewer; 