import { defineConfig } from 'tsup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

export default defineConfig({
  entry: ['index.ts'],
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
    'react',
    'ink',
    'ink-form',
    'ink-scroll-view',
    'open',
    'commander',
    'pino',
    '@modelcontextprotocol/client',
    '@modelcontextprotocol/core',
    '@napi-rs/keyring',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@inspector/core': path.join(repoRoot, 'core'),
    };
    options.jsx = 'automatic';
  },
});
