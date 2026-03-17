# Forenzo

Forensic interview video platform for Children's Advocacy Centers (CACs). Upload forensic interview recordings, automatically transcribe with speaker diarization, generate AI review indices with timestamped key moments, and share securely with law enforcement, prosecutors, and MDT members via PIN-protected magic links.

## Maintenance Rules

### Keep documentation files up to date
- When adding, removing, renaming, or changing the purpose of any file or folder, update the corresponding entry in the README.md
- When the structure of the project, the tech stack, or the developer setup changes, update README.md with the details.
- When adding new commands, dependencies, or architectural patterns, update the relevant sections of README.md as well.
- When rules for implementation and testing change, update this file AGENTS.md

### CJIS session timeout - background polling rules
- CJIS 5.5.5 requires a 30-minute inactivity timeout. Background pollers (setInterval) must NEVER refresh the session.
- Any `setInterval` or recurring fetch that runs without user interaction MUST use `backgroundFetch` (from `src/utils/api.ts`), NOT `authFetch` or raw `fetch`.
- `backgroundFetch` adds an `X-Background-Poll: true` header. The server sees this and authenticates WITHOUT extending the session expiry (via Better Auth's `disableRefresh: true`).
- The ONLY pollers that should use regular `authFetch` are ones tied to active video playback (session heartbeat, watch progress) - because watching a video IS user activity.
- If you add a new poller or setInterval that hits an authenticated endpoint, use `backgroundFetch`. If you use `authFetch` instead, the 30-minute idle timeout breaks and CJIS compliance is violated.
- The CORS config in `server/index.ts` reflects whatever headers the client requests (no explicit allowlist). No special CORS setup needed for new custom headers.

### Always test new or modified code
- Ensure all code has corresponding tests
- Ensure test coverage for each file is at least 90%
- In unit tests that expect error output, suppress it from the console

### Responding to Code Reviews
- When asked to respond to a code review of a PR,
  - it is not necessary to implement all suggestions
  - you are free to implement suggestions in a different way or to ignore if there is a good reason
  - after making the changes, respond to each review comment with what was done (or why it was ignored)

### Lint-fixed, Formatted code
- Ensure linting and formatting are applied after every change
- ALWAYS do `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` before pushing any changes

### Typescript instructions
- Use TypeScript for all new code
- Follow TypeScript best practices and coding standards
- NEVER use 'any' as a type
- NEVER suppress error types (e.g., no-unused-vars, no-explicit-any) in the typescript or eslint configuration as a way of satisfying the linter or compiler.
- Utilize type annotations and interfaces to improve code clarity and maintainability
- Leverage TypeScript's type inference and static analysis features for better code quality and refactoring
- Use type guards and type assertions to handle potential type mismatches and ensure type safety
- Take advantage of TypeScript's advanced features like generics, type aliases, and conditional types to write more expressive and reusable code
- Regularly review and refactor TypeScript code to ensure it remains well-structured and adheres to evolving best practices

## React instructions
- UI Components
  - We are using the Mantine component library for UI.
  - Instructions are at https://mantine.dev/llms.txt
  - Avoid using div and other basic HTML elements for layout purposes.
  - Prefer Mantine's Box, Group, and Stack components for layout.
  - Use Mantine's theme and styling utilities to ensure a consistent and responsive design.
  - NEVER use inline styles on a component.
  - NEVER use raw hex values (`#ddd`, `#94a3b8`, etc.) or `rgba()` literals for colors in component props or theme files. Use `--forenzo-*` CSS custom properties defined in `App.css :root` (e.g., `c: 'var(--forenzo-text-primary)'`). If no existing token fits, add one to `:root` first.
  - NEVER add a CSS class to a Mantine component when the styles can instead be expressed as component props or a theme variant. CSS classes are a last resort.
  - PREFER component props (via `.withProps()`) to CSS for behavioral and visual styles.
  - PREFER defining styles as theme variants (via `Component.extend()` in `src/theme/<Component>.ts`) over CSS classes. Each Mantine component with custom variants has its own file in `src/theme/`, exporting a `Theme<Name>` constant. The barrel `src/theme/index.ts` re-exports them all and `theme.ts` imports from the barrel. Flat CSS properties (margin, padding, background, border, color, font-size, etc.) belong in the theme. Only pseudo-selectors, nested child selectors, keyframes, and native HTML element styles belong in App.css.
  - App.css must contain ONLY styles that cannot be expressed in the Mantine theme: `@keyframes`, pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships, nested child-element selectors for third-party HTML output (e.g. ReactMarkdown), and styles for native HTML elements (`img`, `iframe`). When refactoring a component, actively move any flat CSS properties out of App.css and into theme variants or `.withProps()` constants.
  - NEVER use inline code; instead extract to functions in the same file, exported or located in a shared location if immediately reusable.
  - In a component's file, for sub-components:
    - ALWAYS use Mantine components for layout and content, configured with props for styling and behavior.
    - ALWAYS declare a subcomponent as a named constant using `.withProps()` if it has two or more props.
    - NEVER use `Box` for subcomponent constants — `Box` does not support `.withProps()`. Use `Group`, `Stack`, `Flex`, `Text`, `Paper`, `UnstyledButton`, or `Image` instead. Pick the component that best matches the purpose: `Paper` for bordered/surfaced containers, `Text` for any text or content wrapper, `Stack`/`Group`/`Flex` for layout.
    - NEVER use a CSS class on a subcomponent constant when the styles can be expressed as a Mantine theme variant instead. Define variants in `src/theme/<Component>.ts` using `Component.extend({ styles: (_theme, props) => { ... } })` and reference them with `variant="variantName"` on the component or in `.withProps()`.
    - CSS classes are ONLY acceptable on subcomponents for styles that cannot be expressed as flat CSS-in-JS properties in the theme — specifically: pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships (`.parent:hover .child`), nested child-element selectors (`.wrapper p`, `.wrapper code`), `@keyframes` definitions, and native HTML elements (`img`, `iframe`) that are not Mantine components.
    - When a theme variant needs a CSS class for nested/pseudo selectors, use `classNames` in the theme extension to auto-assign it — never add `className` manually in JSX for theme-styled components.
    - Example — subcomponent constant with `withProps`:
    ```tsx
      const CardContent = Group.withProps({
        flex: 1,
        align: 'flex-start',
        justify: 'space-between',
        wrap: 'nowrap',
      });
      return <CardContent> ... </CardContent>
    ```
    - Example — theme variant with auto-assigned className for nested selectors:
    ```tsx
      // src/theme/Paper.ts
      export const ThemePaper = Paper.extend({
        classNames: (_theme, props) => {
          if (props.variant === 'message') return { root: 'message' };
          return {};
        },
        styles: (_theme, props) => {
          if (props.variant === 'message') {
            return { root: { padding: '1.5rem', borderRadius: 12 } };
          }
          return { root: {} };
        },
      }),

      // Component.tsx
      const MessageContainer = Paper.withProps({ variant: 'message' });
    ```

### Database & Prisma instructions

#### Schema management
- The database schema is managed by [Prisma ORM](https://www.prisma.io/). The schema is defined in `prisma/schema.prisma`.
- To change the schema (add/remove tables, columns, enums, etc.):
  1. Edit `prisma/schema.prisma`
  2. Run `npm run db:migrate` to generate and apply a migration
  3. Prisma auto-generates the migration SQL in `prisma/migrations/`
- NEVER edit migration files in `prisma/migrations/` by hand — they are auto-generated.
- NEVER write raw SQL for schema changes — use Prisma Migrate.

#### Two database pools
- **Prisma client** (`server/lib/prisma.ts`) — all application queries. Import as `import { prisma } from '../lib/prisma'`.
- **Better Auth pg Pool** (`server/lib/auth.ts`, 5 connections) — Better Auth's own pool for session/user management. Do NOT touch this pool in application code.
- Better Auth tables (User, Session, Account, Organization, Member, etc.) are in the Prisma schema for type safety and can be READ via Prisma, but Better Auth manages their lifecycle.

#### Writing queries
- Prefer Prisma's typed query builder over raw SQL for all new queries.
- Import the client: `import { prisma } from '../lib/prisma'`
- Import types when needed: `import { Prisma } from '@prisma/client'` or `import type { CaseStatus } from '@prisma/client'`
- Model names use PascalCase: `Case`, `Video`, `Transcript`, `TranscriptSegment`, `AiSummary`, `Share`, `ProcessingJob`, `VideoTag`, `ApiKey`, `Billing`, `TagCategory`, `TagPreferences`, `MultipartUpload`, `McpToken`, `PinRateLimit`, `TranscriptCorrection`, `TranscriptReview`, `TranscriptQaCache`, `ReviewAttestation`, `OrgSettings`
- Field names use camelCase (mapped to snake_case columns via `@map`): `caseNumber`, `childFirstName`, `videoId`, `fileSizeBytes`, `storagePath`, `speakerNames`, etc.

#### Type conversions in responses
- `BigInt` fields (e.g., `fileSizeBytes`): use `Number()` before JSON serialization
- `Decimal` fields (e.g., `durationSecs`, `confidence`): use `Number()` before JSON serialization
- `Json` fields (e.g., `metadata`, `speakerNames`, `permissions`): cast with `as Record<string, unknown>` or appropriate type
- Prisma enums (e.g., `CaseStatus`, `ProcessingStatus`): use directly, they serialize as strings

#### Transactions
- Use `prisma.$transaction(async (tx) => { ... })` for multi-step operations
- Inside the transaction callback, use `tx.model.method()` instead of `prisma.model.method()`
- Raw SQL inside transactions: `tx.$queryRaw` / `tx.$executeRaw`

#### Raw SQL — last resort only
- The goal is to minimize raw SQL in TypeScript. Always try Prisma's query builder first.
- `$queryRaw` — returns rows. Use for SELECT queries that Prisma can't express.
- `$executeRaw` — returns affected row count. Use for INSERT/UPDATE/DELETE that Prisma can't express.
- Raw SQL is acceptable ONLY for these specific PostgreSQL features:
  - **`access_log` table** — partitioned, not modeled in Prisma. All reads/writes must be raw.
  - **Full-text search** — `websearch_to_tsquery`, `ts_headline`, `ts_rank`
  - **Advisory locks** — `pg_try_advisory_xact_lock`
  - **Atomic UPDATE ... RETURNING** with conditional WHERE (check-and-act in one statement)
  - **`make_interval()`** — PostgreSQL interval construction from numeric values
  - **LATERAL JOIN** — correlated subqueries in FROM clause
  - **SELECT ... FOR UPDATE** — row-level locking
- If you find yourself writing raw SQL for anything else (simple CRUD, JOINs, aggregations, filters), stop and use the Prisma query builder instead.
- Always use tagged template literals for safe parameterization:
  ```ts
  prisma.$queryRaw`SELECT ... WHERE id = ${someVar}`
  ```
- NEVER use `prisma.$queryRawUnsafe` — SQL injection risk.
- Type casts required in raw SQL (Prisma tagged templates send JS types, PostgreSQL won't auto-coerce):
  - `${id}::uuid` for UUID columns (but NOT for `access_log.resource_id` — it's TEXT)
  - `${ip}::inet` for inet columns
  - `${JSON.stringify(obj)}::jsonb` for jsonb columns
  - `${value}::access_action` for enum columns

#### Queries involving Better Auth user lookups
- No FK relation exists from application tables to the `user` table (deliberate — Better Auth manages those tables)
- For user name lookups, do a separate query: `prisma.user.findUnique({ where: { id }, select: { name: true } })`
- For batch lookups: `prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })` and build a Map
