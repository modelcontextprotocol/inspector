/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@inspector/core': path.resolve(dirname, '../../core'),
    },
    // Source files in core/ import bare modules (react, @testing-library/react,
    // etc.) that only exist in clients/web/node_modules. Dedupe ensures Vite
    // resolves them from this package rather than walking up from core/'s
    // location (which has no node_modules of its own yet).
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      allow: [path.resolve(dirname, '../..')],
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Files under core/ live outside this project's root (clients/web/), so
      // vitest's default project-root prefix filter would drop them before the
      // include glob runs. allowExternal lets the include filter apply to them.
      allowExternal: true,
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/utils/**/*.{ts,tsx}',
        path.join(repoRoot, 'core/mcp/**/*.{ts,tsx}'),
        path.join(repoRoot, 'core/react/**/*.{ts,tsx}'),
      ],
      exclude: [
        '**/*.stories.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.fixtures.{ts,tsx}',
        '**/index.{ts,tsx}',
        'src/components/**/types.ts',
        // Pure-type modules: `interface`/`type` declarations only, no runtime
        // statements. Coverage tools either silently drop them (rolldown can't
        // parse raw `import type {...}` syntax) or surface them as misleading
        // 0/0 rows. Excluding them keeps the report clean.
        path.join(repoRoot, 'core/mcp/types.ts'),
        path.join(repoRoot, 'core/mcp/elicitationCreateMessage.ts'),
        path.join(repoRoot, 'core/mcp/samplingCreateMessage.ts'),
        path.join(repoRoot, 'core/mcp/sessionStorage.ts'),
        path.join(repoRoot, 'core/mcp/inspectorClientProtocol.ts'),
        // inspectorClientEventTarget.ts is types + a single empty-body class
        // (extends TypedEventTarget). v8/istanbul records 0 statements for it.
        path.join(repoRoot, 'core/mcp/inspectorClientEventTarget.ts'),
        path.join(repoRoot, 'core/mcp/__tests__/**'),
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 85,
        functions: 80,
        branches: 50,
      },
    },
    projects: [
      {
        extends: true,
        resolve: {
          alias: {
            '@inspector/core': path.resolve(dirname, '../../core'),
            // Bare-module override: core/react/* imports "react", which vite
            // resolves by walking up from the file looking for node_modules/.
            // We move the unit project root to repoRoot below, and the repo
            // root has no node_modules of its own — so without this alias,
            // imports from core/ can't find react.
            react: path.resolve(dirname, 'node_modules/react'),
          },
          dedupe: ['react', 'react-dom'],
        },
        test: {
          name: 'unit',
          environment: 'happy-dom',
          // Root the unit project at the repo root so vitest's coverage
          // transformer (which only processes files inside a project root)
          // can reach core/ modules. Without this, untested core/ files fall
          // back to raw-TS parsing in rolldown, which can't handle TS-only
          // syntax (e.g. `import type`) — silently dropping them and bypassing
          // the per-file gate.
          root: repoRoot,
          // No `globals: true` — every test file imports `describe`, `it`,
          // `expect`, `vi` explicitly from "vitest". This keeps the pattern
          // consistent and avoids relying on auto-cleanup tied to Vitest's
          // global lifecycle hooks; cleanup is invoked manually in setup.ts.
          include: ['clients/web/src/**/*.test.{ts,tsx}'],
          setupFiles: [path.join(dirname, 'src/test/setup.ts')],
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
