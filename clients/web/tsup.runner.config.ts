import { defineConfig } from 'tsup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'build',
  clean: true,
  sourcemap: true,
  target: 'node22',
  platform: 'node',
  noExternal: [/^@inspector\/core/],
  external: [
    'commander',
    'open',
    'pino',
    'hono',
    '@hono/node-server',
    'vite',
    '@vitejs/plugin-react',
    'zustand',
    'atomically',
    'chokidar',
    '@napi-rs/keyring',
    '@modelcontextprotocol/sdk',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@inspector/core': path.join(repoRoot, 'core'),
    };
  },
});
