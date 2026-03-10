# Inspector V2 UX - Component Development

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | V2 UX
#### [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md) | Components

We are developing React components with Mantine, Zustand, and Storybook using a pattern called "Presentational Components" that emphasizes separation of concerns and testability. 

## The Presentational / Container Split

The idea is that a component receives everything it needs through props — the data it renders *and* the callbacks it fires when the user interacts. The component itself has no idea where the data came from or what happens when a button is clicked. It just calls `onSave(formData)` and trusts that someone upstream is handling it.

This creaes clean layering: Zustand stores own the state and logic, container components (or hooks) wire stores to presentational components, and the presentational components themselves are pure rendering machines. Storybook targets that bottom layer exclusively.

## What Storybook Does

Storybook gives you a dev server that renders individual components in isolation, outside your application's component tree. You write "stories" — which are essentially named configurations of a component with specific props. A story for a `UserCard` might look like:

```typescript
export const Default: Story = {
  args: {
    user: { name: 'Ada Lovelace', role: 'Engineer' },
    onEdit: fn(),
    onDelete: fn(),
  },
};

export const LongName: Story = {
  args: {
    user: { name: 'A Very Long Username That Might Break Layout', role: 'Admin' },
    onEdit: fn(),
    onDelete: fn(),
  },
};
```

Each story appears in a sidebar, and you click through them to visually verify the component under different conditions. The `fn()` helper from Storybook creates a mock function that logs calls to an "Actions" panel, so you can see "onDelete was called with these arguments" without any real logic executing.

## Storybook Development Loop

The typical cycle is: define the component's prop interface (the "model" in your framing), write the component to render based on those props, write stories that exercise various prop combinations (empty states, error states, loading, overflowing content, etc.), and then visually verify in the Storybook UI. You do all of this before the component ever touches real data or lives inside the actual app.

This naturally pushes you toward building bottom-up — atoms first (buttons, inputs, badges), then molecules (form groups, cards), then organisms (full panels, modals). You can't easily skip ahead and build a page-level component first because it would need too many dependencies you haven't isolated yet.

## Disciplines That Keep Logic Out of Components

This is where the real challenge lives, because React makes it *very* easy to let logic creep in. A few principles worth internalizing:

**Props as the complete contract.** If a component needs to know whether a user has permission to delete something, don't pass in the user's role and let the component figure it out. Pass `canDelete: boolean`. The decision logic belongs in the store or a hook, not in the rendering layer. This also makes stories trivial to write — you just set `canDelete` to `true` or `false`.

**Callbacks over store access.** If a presentational component imports a Zustand store directly, it's no longer testable in isolation without mocking the store. Instead, have a thin wrapper hook or container that does `const { items, addItem } = useStore(...)` and passes those down. The presentational component just sees `items: Item[]` and `onAdd: (item: Item) => void`.

**Derived state lives outside.** Filtering, sorting, computed totals — all of that should happen in Zustand selectors or custom hooks, not inside the component. The component receives the *already filtered* list.

**Local UI state is the exception.** Things like "is this dropdown open" or "which tab is active" are legitimately component-internal. That's fine — that's UI state, not application state. The heuristic is: if the application would need to know about it (say, to restore state on navigation), it belongs in Zustand. If only the component cares, `useState` is appropriate.

## Mantine-Specific Considerations

Since Mantine provides a theming layer and its own component library, we will want our Storybook to wrap stories in Mantine's `MantineProvider` with our theme. This is done through Storybook's `decorators` in the config, so every story gets the correct styling context. We can just write global decorators manually, but there's a `storybook-addon-mantine` package that simplifies this.

## Is Storybook the Only Option?

It's the most mature choice, but it's not the only one. Ladle is a lighter alternative with a similar API. Histoire is popular in the Vue world but has React support. Some teams skip a dedicated tool entirely and just create a `/dev` route in their app that renders a component gallery — less infrastructure, but you lose the story-based organization and addon ecosystem.

For your stack, Storybook is the most well-trodden path and has the best TypeScript support for auto-generating controls from your prop types, which is genuinely useful. It will infer knobs/controls from your interfaces so you can tweak props interactively in the browser.

The bottom line: your instinct is right. Design your components around a typed model (the props interface), keep decision-making in Zustand, and Storybook becomes the natural place to develop and verify the visual layer independently. The discipline isn't really about Storybook — it's about prop interface design. Storybook just makes it obvious when you've violated the boundary, because a component that reaches outside its props becomes painful to write stories for.
