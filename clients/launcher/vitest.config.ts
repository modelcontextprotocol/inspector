import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        // Binary bootstrap: shebang + commander wiring that dynamically imports
        // each client's build/index.js and dispatches via process.exit. It only
        // runs when launched as the real binary and is covered end-to-end by the
        // launcher smokes (smoke:launcher / smoke:cli / smoke:tui / smoke:web).
        // Mirrors the cli/web `index.ts` exclusion. The pure arg-parsing logic
        // lives in parse-launcher-argv.ts, which is unit-tested and gated below.
        'src/index.ts',
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 85,
        functions: 80,
        branches: 50,
      },
    },
  },
});
