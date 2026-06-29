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
  sourcemap: true,
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
    'zustand',
    '@modelcontextprotocol/sdk',
    '@napi-rs/keyring',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@inspector/core': path.join(repoRoot, 'core'),
    };
    options.jsx = 'automatic';
  },
});
