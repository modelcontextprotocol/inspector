import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// The TUI is Node + React (Ink) TypeScript. This mirrors the web client's flat
// config minus the browser-only plugins (react-refresh / Storybook).
//
// react-hooks is registered for the two classic rules the Ink components were
// written against (rules-of-hooks + exhaustive-deps, which the source already
// references in inline disable directives). We deliberately do NOT pull in the
// full react-hooks@7 "recommended" set: its newer error-level rules (e.g.
// set-state-in-effect) flag long-standing, intentional patterns in the
// component/hook surface that is itself the interim-excluded one tracked in
// #1501. Enforcing them would require refactoring code out of scope here.
export default defineConfig([
  globalIgnores(['build', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
