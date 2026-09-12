/**
 * Setup file for the `storybook` Vitest project (#2323).
 *
 * It exists for one call. Storybook's instrumented Testing Library re-exports
 * the same `asyncUtilTimeout: 1000` default as the unit project's, and it
 * governs the 80 `waitFor` / `findBy*` sites across the story files. Those play
 * functions run in a real Chromium against a real Storybook preview, so 1000ms
 * is the *tighter* of the two bounds the project has — the per-test ceiling is
 * 15000 (#2292) — and it is the one nobody chose.
 *
 * ⚠️ Two things about this file that are deliberate and easy to undo:
 *
 * 1. **It must not live in `.storybook/`, and must not call
 *    `setProjectAnnotations`.** `@storybook/addon-vitest` provisions the
 *    preview annotations itself, and skips doing so when it finds a setup file
 *    that is *both* inside `configDir` and contains that call (#1898) — so the
 *    old `.storybook/vitest.setup.ts` was opting out of the automatic path.
 *    Either half of the condition is enough to stay on it; this file misses
 *    both. `src/test/PreviewAnnotations.stories.tsx` asserts the provisioning
 *    directly, so a regression here fails a test rather than silently rendering
 *    every story without the Mantine decorator.
 * 2. **The import is `storybook/test`, not `@testing-library/*`.** Storybook
 *    instruments its own copy so the interactions panel can trace each step;
 *    configuring a different copy would change nothing that a play function
 *    actually calls.
 */

import { configure } from "storybook/test";

configure({ asyncUtilTimeout: 5000 });
