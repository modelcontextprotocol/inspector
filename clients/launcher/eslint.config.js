import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// The launcher is plain Node TypeScript (no React/browser), so this mirrors
// the web client's flat config minus the React/Storybook plugins.
export default defineConfig([
  globalIgnores(['build', 'coverage']),
  {
    files: ['**/*.{ts,mts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
]);
