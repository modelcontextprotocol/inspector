# Inspector V2

This is an application for inspecting MCP servers. Has three incarnations, Web, TUI, and CLI.

## Project Structure

```
inspector/
├── clients/                            
│   ├── web/                            # Web client code
│   ├── cli/                            # CLI client code
│   ├── tui/                            # TUI client code
│   ├── launcher/                       # Shared launcher 
├── core/                               # Shared core code
├── soecification/                      # Build specification
...
```

## Repository & Project Board

- **Repo**: https://github.com/modelcontextprotocol/inspector.git
- **Base Branches**: v2/main, v1.5/main, main
- **Project Boards**: 
  - v2 - https://github.com/orgs/modelcontextprotocol/projects/28
  - v1.5 - https://github.com/orgs/modelcontextprotocol/projects/39
  - v1 - https://github.com/orgs/modelcontextprotocol/projects/11

## Project Status and Direction
* The main branch currently contains the legacy version of the Inspector, which we are accepting bug fixes and minor improvement PRs for.

* The v1.5/main branch contains an intermediate version of the Inspector, where the shared logic between the three incarnations of the Inspector are extracted into a core subsystem with InspectorClient class as the common entry point. It also includes the TUI, a refactored CLI, and streamlined launcher.

* The v2/main branch currently contains the new version of the web Inspector, composed of "dumb" components which accept data and callbacks as props and contain only display logic. 

* The InspectorClient from v1.5/main will be merged into v2/main, and wired up to the new web Inspector. The TUI and CLI will follow. Eventually when everything works on v2/main we will replace main with v2/main, eliminating the legacy implementations.

## Maintenance Rules

### Keep documentation files up to date
- When adding, removing, renaming, or changing the purpose of any file or folder, update the corresponding entry in the main README.md and/or the related clients/*/README.md
- When the structure of the project, the tech stack, or the developer setup changes, update appropriate README.md files with the details.
- When adding new commands, dependencies, or architectural patterns, update the relevant sections of appropriate README.md files as well.
- When rules for implementation and testing change, update this file AGENTS.md

### Issue-driven Work Style

All work should be driven by items on the project board.

- Before starting work, check the board for the relevant item.
- **Draft items vs. issues**: Board items may be draft items (no issue number) or full GitHub issues. Before creating a new issue, always check if a matching draft item already exists on the board. If it does, convert it to an issue using `gh project item-edit` or create the issue and link it — **never create a duplicate**.
- When work begins, create a feature branch and move the item to "In Progress".
- When work is complete:
  - Run format, lint, typecheck, build, and test — ensure all checks pass
  - Open a PR against `main` and move the item to "In Review"
- If new tasks are discovered or requested during development, create issues and add them to the board.

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
- ALWAYS do `npm run validate` before pushing any changes, this runs the various lint, build, format checks, etc.

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
  - NEVER use raw hex values (`#ddd`, `#94a3b8`, etc.) or `rgba()` literals for colors in component props or theme files. Use `--inspector-*` CSS custom properties defined in `App.css :root` (e.g., `c: 'var(--inspector-text-primary)'`). If no existing token fits, add one to `:root` first.
  - NEVER add a CSS class to a Mantine component when the styles can instead be expressed as component props or a theme variant. CSS classes are a last resort.
  - PREFER component props (via `.withProps()`) to CSS for behavioral and visual styles.
  - PREFER defining styles as theme variants (via `Component.extend()` in `src/theme/<Component>.ts`) over CSS classes. Each Mantine component with custom variants has its own file in `src/theme/`, exporting a `Theme<Name>` constant. The barrel `src/theme/index.ts` re-exports them all and `theme.ts` imports from the barrel. Flat CSS properties (margin, padding, background, border, color, font-size, etc.) belong in the theme. Only pseudo-selectors, nested child selectors, keyframes, and native HTML element styles belong in App.css.
  - App.css must contain ONLY styles that cannot be expressed in the Mantine theme: `@keyframes`, pseudo-selectors (`:hover`, `:focus`), cross-component hover relationships, nested child-element selectors for third-party HTML output (e.g. ReactMarkdown), and styles for native HTML elements (`img`, `iframe`). When refactoring a component, actively move any flat CSS properties out of App.css and into theme variants or `.withProps()` constants.
  - NEVER use inline code; instead extract to functions in the same file, exported or located in a shared location if immediately reusable.
  - In a component's file, for sub-components:
    - ALWAYS use Mantine components for layout and content, configured with props for styling and behavior.
    - ALWAYS declare a meaningfully named subcomponent as a constant using `.withProps()` if a component has two or more props.
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
- Theme files vs. Storybook element components
  - **Theme files** (`src/theme/<Component>.ts`) and **element components** (`src/components/elements/`) serve different purposes and both are needed.
  - Theme files customize every instance of a Mantine component app-wide — defaults (size, radius), custom variants, and global style overrides. They are applied automatically by `MantineProvider`.
  - Element components add domain-specific semantics on top of Mantine primitives. For example, `AnnotationBadge` maps domain concepts (audience, destructive, longRun) to Mantine's styling primitives (color, variant). Storybook documents these domain components for designers and developers.
  - Element components MUST import from `@mantine/core`, NOT from `src/theme/`. The theme layer is applied transparently by the provider — elements do not need to know about `Theme<Name>` constants.
  - NEVER push domain-specific variant logic (e.g., annotation types, transport types) into theme files. Domain variants belong in the element component that owns those semantics. Theme files are for styling that applies to the Mantine primitive globally.
