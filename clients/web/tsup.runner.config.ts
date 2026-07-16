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
  // No source maps in the published bundle — they roughly double the on-disk
  // size and aren't needed at runtime (debug via `npm run dev` on the source).
  sourcemap: false,
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
    'atomically',
    'chokidar',
    '@napi-rs/keyring',
    '@modelcontextprotocol/client',
    '@modelcontextprotocol/core',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@inspector/core': path.join(repoRoot, 'core'),
    };
  },
});
