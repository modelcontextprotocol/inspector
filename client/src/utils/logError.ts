export type LogErrorParams = {
  type: 'general' | 'server';
  serverName?: string;
  message: string;
};

export async function logError({ type, serverName, message }: LogErrorParams) {
  console.log('Calling logError', { type, serverName, message });
  try {
    await fetch('http://localhost:6277/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, serverName, message }),
    });
  } catch (err) {
    // Optionally log to console for dev
    console.warn('Failed to send log to backend:', err);
  }
} 