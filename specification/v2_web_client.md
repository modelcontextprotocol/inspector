# Inspector V2 Tech Stack

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

#### Web Client | [Server](v2_server.md)  | [Storage](v2_storage.md)

## Overview
### Language and Framework
* Typescript
* React

### Components and Theme
* -[x] [Mantine](https://ui.mantine.dev/)
* -[ ] [Shadcn](https://ui.shadcn.com/)

#### Mantine Rationale

Mantine is recommended based on evaluation of both prototype implementations (`v2/prototype/shadcn` and `v2/prototype/mantine`) and group discussion.

**Notes from Prototype Comparison:**

Shadcn lacks layout components, requiring extensive Tailwind class management for containers, spacing, and alignment. This adds friction and cognitive load, based on our experiences with the current Inspector. Mantine's layout components (`Flex`, `Stack`, etc.) make the code more concise and easier to understand.

Although the code may be less directly customizable, we don't expect  extensive theming or branding to be a priority for Inspector as a debugging tool.

See [PR #980 discussion](https://github.com/modelcontextprotocol/inspector/pull/980#issuecomment-3667102518) for example code comparison.

| Requirement | Mantine | Shadcn |
|-------------|---------|--------|
| Layout components | Yes - Flex, Stack, Group, Grid | No - Use Tailwind divs |
| Out-of-box experience | Yes - Comprehensive | Partial - Assemble yourself |
| Code verbosity | Concise JSX props | Verbose Tailwind classes |
| Styling approach | Props + theme config | Tailwind utility classes |
| Documentation | Extensive API docs | Component examples |

**Benefits:**

1. **Built-in Layout Components** - Mantine provides layout primitives as JSX components:
   - `Flex`, `Stack`, `Group`, `Grid`, `Center`, `Container`
   - No need to manage `div` elements with Tailwind classes
   - More declarative, readable code

2. **Reduced Class Management** - Compare the same UI element:
   ```tsx
   // Mantine - concise
   <Alert icon={<IconAlertTriangle />} color="yellow" title="Warning">
     {message}
   </Alert>

   // Shadcn + Tailwind - verbose class strings
   <div className="flex items-start gap-3 rounded-lg border border-yellow-200
     bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950
     dark:text-yellow-200">
     <IconAlertTriangle className="h-5 w-5 flex-shrink-0" />
     <div className="flex-1"><p className="font-medium">Warning</p>{message}</div>
   </div>
   ```

3. **Better Out-of-Box Experience**:
   - Single install provides all components
   - Consistent API across all components
