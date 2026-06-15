import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { vitestSharedPaths } from '../../vitest.shared.mts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { projectResolve } = vitestSharedPaths(dirname);

export default defineConfig({
  resolve: projectResolve,
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
