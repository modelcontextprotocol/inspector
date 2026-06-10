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
  target: 'node20',
  platform: 'node',
  // Bundle core source; leave npm deps external.
  noExternal: [/^@inspector\/core/],
  esbuildOptions(options) {
    options.alias = {
      '@inspector/core': path.join(repoRoot, 'core'),
    };
  },
});
