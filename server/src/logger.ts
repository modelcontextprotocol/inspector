// Logger utility for backend error logging (Node.js/TypeScript)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let logsDir = path.join(__dirname, '../../logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  // Fallback: use process.cwd()/logs
  logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}
console.log('[Logger] Using logs directory:', logsDir);

export function logGeneral(message: string) {
  const logPath = path.join(logsDir, 'general.log');
  const logEntry = `[${new Date().toISOString()}] ${message}\n`;
  console.log('Writing to general.log:', logEntry); // Debug log
  fs.appendFileSync(logPath, logEntry);
  console.log('Wrote to general.log'); // Debug log
}

export function logServer(serverName: string, message: string) {
  const safeName = serverName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const logPath = path.join(logsDir, `server-${safeName}.log`);
  const logEntry = `[${new Date().toISOString()}] ${message}\n`;
  console.log(`Writing to server-${safeName}.log:`, logEntry); // Debug log
  fs.appendFileSync(logPath, logEntry);
  console.log(`Wrote to server-${safeName}.log`); // Debug log
}

export { logsDir }; 