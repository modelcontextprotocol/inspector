import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { logServer } from './logger.js';

export function launchMCPServer(command: string, args: string[], env: NodeJS.ProcessEnv = {}, serverName: string = 'unknown') {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    logServer(serverName, `[stdout] ${chunk.toString()}`);
  });

  child.stderr.on('data', (chunk) => {
    logServer(serverName, `[stderr] ${chunk.toString()}`);
  });

  child.on('exit', (code, signal) => {
    logServer(serverName, `[info] Process exited with code ${code}, signal ${signal}`);
  });

  return child;
} 