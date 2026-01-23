# Resource Subscriptions and ListChanged Notifications Design

## Overview

This document outlines the design for adding support for:

1. **Resource subscriptions** - Subscribe/unsubscribe to resources and handle `notifications/resources/updated` notifications
2. **ListChanged notifications** - Handle `notifications/tools/list_changed`, `notifications/resources/list_changed`, and `notifications/prompts/list_changed`
3. **Resource content caching** - Maintain loaded resource content in InspectorClient state
4. **Prompt content caching** - Maintain loaded prompt content and parameters in InspectorClient state
5. **Tool call result caching** - Maintain the most recent call result for each tool in InspectorClient state

## Goals

- Enable InspectorClient to support resource subscriptions (subscribe/unsubscribe)
- Support all listChanged notification types with configurable enable/disable
- Cache loaded resource content to avoid re-fetching when displaying
- Cache loaded prompt content and parameters to avoid re-fetching when displaying
- Cache tool call results to enable UI state persistence (especially useful for React apps)
- Auto-reload lists when listChanged notifications are received
- Auto-reload subscribed resources when resource updated notifications are received
- Emit appropriate events for UI updates

## Design Decisions

### 1. Configuration Options

Add to `InspectorClientOptions`:

```typescript
export interface InspectorClientOptions {
  // ... existing options ...

  /**
   * Whether to enable listChanged notification handlers (default: true)
   * If enabled, InspectorClient will automatically reload lists when notifications are received
   */
  listChangedNotifications?: {
    tools?: boolean; // default: true
    resources?: boolean; // default: true
    prompts?: boolean; // default: true
  };
}
```

**Rationale:**

- Grouped under `listChangedNotifications` object for clarity
- Individual flags allow fine-grained control
- Default to `true` for all to match web client behavior

### 2. Resource Content Caching

**Current State:**

- `InspectorClient` stores `resources: Resource[]` (full resource objects with `uri`, `name`, `description`, `mimeType`, etc.)
- Content is fetched on-demand via `readResource()` but not cached

**Proposed State:**

- Keep resource descriptors separate from cached content
- Maintain `resources: Resource[]` for server-provided descriptors
- Add separate cache structure for loaded content

**Cache Structures:**

```typescript
// For regular resources (cached by URI)
interface ResourceContentCache {
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
  timestamp: Date; // When content was loaded
}

// For resource templates (cached by uriTemplate - the unique ID of the template)
interface ResourceTemplateContentCache {
  uriTemplate: string; // The URI template string (unique ID)
  expandedUri: string; // The expanded URI
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
  timestamp: Date; // When content was loaded
  templateName: string; // The name/ID of the template
  params: Record<string, string>; // The parameters used to expand the template
}
```

**Storage:**

- `private resources: Resource[]` - Server-provided resource descriptors (unchanged)
- Cache is accessed via `client.cache.getResource(uri)` for regular resources
- Cache is accessed via `client.cache.getResourceTemplate(uriTemplate)` for template-based resources
- The `ContentCache` object internally manages:
  - Regular resource content (keyed by URI)
  - Resource template content (keyed by uriTemplate - the unique template ID)
  - Prompt content
  - Tool call results
- Cache is independent of descriptors - can be cleared without affecting server state
- Regular resources and resource templates are cached separately (different maps, different keys)

**Benefits of Separate Cache Structure:**

- **True cache semantics** - Can clear cache independently of descriptors without affecting server state
- **Memory management** - Can implement TTL, LRU eviction, size limits in the future without touching descriptors
- **Separation of concerns** - Descriptors (`resources[]`) are server state, cache (`resourceContentCache`) is client state
- **Flexibility** - Can cache multiple versions or implement cache policies without modifying descriptor structure
- **Clear API** - `getResources()` returns descriptors, `client.cache.getResource()` returns cached content
- **Cache invalidation** - Can selectively clear cache entries without reloading descriptors
- **List reload behavior** - When descriptors reload, cache is preserved for existing items, cleaned up for removed items
- Avoid re-fetching when switching between resources in UI
- Enable offline viewing of previously loaded resources
- Support resource update notifications by updating cached content

### 2b. Prompt Content Caching

**Current State:**

- `InspectorClient` stores `prompts: Prompt[]` (full prompt objects with `name`, `description`, `arguments`, etc.)
- Content is fetched on-demand via `getPrompt()` but not cached

**Proposed State:**

- Keep prompt descriptors separate from cached content
- Maintain `prompts: Prompt[]` for server-provided descriptors
- Add separate cache structure for loaded content

**Cache Structure:**

```typescript
interface PromptContentCache {
  messages: Array<{ role: string; content: any }>;
  timestamp: Date; // When content was loaded
  params?: Record<string, string>; // The parameters used when fetching the prompt
}
```

**Storage:**

- `private prompts: Prompt[]` - Server-provided prompt descriptors (unchanged)
- Cache is accessed via `client.cache.getPrompt(name)` - single integrated cache object
- The `ContentCache` object internally manages all cached content types
- Cache is independent of descriptors - can be cleared without affecting server state

**Benefits:**

- Avoid re-fetching when switching between prompts in UI
- Enable offline viewing of previously loaded prompts
- Track which parameters were used for parameterized prompts

### 3. ListChanged Notification Handlers

**Implementation:**

- Set up notification handlers in `connect()` method based on config
- Each handler:
  1. Calls the appropriate `list*()` method to reload the list
  2. Updates internal state
  3. Dispatches appropriate `*Change` event

**Handlers needed:**

- `notifications/tools/list_changed` → reload tools list
- `notifications/resources/list_changed` → reload resources list (preserve cached content for existing resources)
- `notifications/prompts/list_changed` → reload prompts list

**Code structure:**

```typescript
// In connect() method
if (
  this.listChangedNotifications?.tools !== false &&
  this.capabilities?.tools?.listChanged
) {
  this.client.setNotificationHandler(
    ToolListChangedNotificationSchema,
    async () => {
      await this.reloadToolsList();
    },
  );
}

if (
  this.listChangedNotifications?.resources !== false &&
  this.capabilities?.resources?.listChanged
) {
  this.client.setNotificationHandler(
    ResourceListChangedNotificationSchema,
    async () => {
      await this.reloadResourcesList(); // Preserves cached content
    },
  );
}
```

**Resource list reload behavior:**

- When `notifications/resources/list_changed` is received, reload the resource descriptors list (`this.resources`)
- For each resource in the new list, check if we have cached content for that URI using `this.cache.getResource(uri)`
- Preserve cached content for resources that still exist in the updated list
- Remove cached content for resources that no longer exist in the list (cache cleanup via `this.cache.clearResource(uri)`)
- Note: Resource template cache is NOT affected by resource list changes - templates are cached separately and independently
- Note: Cache is independent - `client.cache.clearAll()` doesn't affect descriptors, and reloading descriptors doesn't clear template cache

### 4. Resource Subscription Methods

**Note:** Resource subscriptions are server capability-driven. The client checks if the server supports subscriptions (`capabilities.resources.subscribe === true`) and then the client can call subscribe/unsubscribe methods if desired. There is no client config option for this - it's purely based on server capability.

**Public API:**

```typescript
/**
 * Subscribe to a resource to receive update notifications
 * @param uri - The URI of the resource to subscribe to
 * @throws Error if client is not connected or server doesn't support subscriptions
 */
async subscribeToResource(uri: string): Promise<void>;

/**
 * Unsubscribe from a resource
 * @param uri - The URI of the resource to unsubscribe from
 * @throws Error if client is not connected
 */
async unsubscribeFromResource(uri: string): Promise<void>;

/**
 * Get list of currently subscribed resource URIs
 */
getSubscribedResources(): string[];

/**
 * Check if a resource is currently subscribed
 */
isSubscribedToResource(uri: string): boolean;

/**
 * Check if the server supports resource subscriptions
 */
supportsResourceSubscriptions(): boolean;
```

**Internal State:**

- `private subscribedResources: Set<string> = new Set()`

**Implementation:**

- Check server capability: `this.capabilities?.resources?.subscribe === true`
- Call `client.request({ method: "resources/subscribe", params: { uri } })`
- Call `client.request({ method: "resources/unsubscribe", params: { uri } })`
- Track subscriptions in `Set<string>`
- Clear subscriptions on disconnect

### 5. Resource Updated Notification Handler

**Handler:**

- Set up in `connect()` if server supports resource subscriptions (`capabilities.resources.subscribe === true`)
- Handle `notifications/resources/updated` notification

**Behavior:**

1. Check if the resource URI is in `this.subscribedResources`
2. If subscribed AND content is cached (checked via `client.cache.getResource(uri)` for regular resources):
   - Reload the resource content via `readResource()` (which will fetch fresh and update `this.cache.resourceContentCache`)
   - Dispatch `resourceContentChange` event with updated content
3. If subscribed but not cached:
   - Optionally reload (or wait for user to view it)
   - Dispatch `resourceUpdated` event (descriptor-only update)

**Event:**

```typescript
// New event type
interface ResourceContentChangeEvent extends CustomEvent {
  detail: {
    uri: string;
    content: {
      contents: Array<{ uri: string; mimeType?: string; text: string }>;
      timestamp: Date;
    };
  };
}
```

### 6. Cache API Design

**Design: Separate Cache Module with Read/Write and Read-Only Interfaces**

The cache is implemented as a separate module with two interfaces:

1. **ReadWriteContentCache** - Full access (used internally by InspectorClient)
2. **ReadOnlyContentCache** - Read-only access (exposed to users of InspectorClient)

This design provides:

- **Better encapsulation** - InspectorClient doesn't need to know about internal Map structures
- **Separation of concerns** - Cache logic is isolated in its own module
- **Type safety** - Clear distinction between internal and external cache access
- **Testability** - Cache can be tested independently
- **Future extensibility** - Cache can evolve without affecting InspectorClient internals

**API Structure:**

```typescript
// Cache object exposed as property
// Getter methods (read-only access to cached content)
client.cache.getResource(uri);
client.cache.getResourceTemplate(uriTemplate);
client.cache.getPrompt(name);
client.cache.getToolCallResult(toolName);

// Clear methods (remove cached content)
client.cache.clearResource(uri);
client.cache.clearResourceTemplate(uriTemplate);
client.cache.clearPrompt(name);
client.cache.clearToolCallResult(toolName);
client.cache.clearAll();

// Fetch methods remain on InspectorClient (always fetch fresh, cache automatically)
// These methods automatically store results in the cache - no explicit setter methods needed
client.readResource(uri); // → stores in cache.resourceContentCache
client.readResourceFromTemplate(name, params); // → stores in cache.resourceTemplateContentCache
client.getPrompt(name, args); // → stores in cache.promptContentCache
client.callTool(name, args); // → stores in cache.toolCallResultCache
```

**Benefits:**

- **Clear separation** - Cache operations are explicitly namespaced
- **Better organization** - All cache operations in one place
- **Easier to extend** - Can add cache configuration, statistics, policies to cache object
- **Type safety** - Cache object can have its own type/interface
- **Future features** - Cache object can have methods like `configure()`, `getStats()`, `setMaxSize()`, etc.
- **Clearer intent** - `client.cache.getResource()` makes it obvious this is cache access
- **Single integrated cache** - All cached content (resources, prompts, tool results) is managed by one cache object

**Implementation:**

```typescript
class InspectorClient {
  // Server-provided descriptors
  private resources: Resource[] = [];
  private prompts: Prompt[] = [];
  private tools: Tool[] = [];

  // Single integrated cache object
  public readonly cache: ContentCache;

  constructor(...) {
    // Create integrated cache object
    this.cache = new ContentCache();
  }
}

class ContentCache {
  // Internal storage - all cached content managed by this single object
  private resourceContentCache: Map<string, ResourceContentCache> = new Map(); // Keyed by URI
  private resourceTemplateContentCache: Map<string, ResourceTemplateContentCache> = new Map(); // Keyed by uriTemplate
  private promptContentCache: Map<string, PromptContentCache> = new Map();
  private toolCallResultCache: Map<string, ToolCallResult> = new Map();

  getResource(uri: string): ResourceContentCache | null {
    return this.resourceContentCache.get(uri) ?? null;
  }

  getResourceTemplate(uriTemplate: string): ResourceTemplateContentCache | null {
    // Look up by uriTemplate (the unique ID of the template)
    return this.resourceTemplateContentCache.get(uriTemplate) ?? null;
  }

  getPrompt(name: string): PromptContentCache | null {
    return this.promptContentCache.get(name) ?? null;
  }

  getToolCallResult(toolName: string): ToolCallResult | null {
    return this.toolCallResultCache.get(toolName) ?? null;
  }

  clearResource(uri: string): void {
    this.resourceContentCache.delete(uri);
  }

  clearPrompt(name: string): void {
    this.promptContentCache.delete(name);
  }

  clearToolCallResult(toolName: string): void {
    this.toolCallResultCache.delete(toolName);
  }

  clearAll(): void {
    this.resourceContentCache.clear();
    this.promptContentCache.clear();
    this.toolCallResultCache.clear();
  }

  // Future: getStats(), configure(), etc.
}
```

**Cache Storage:**

- Cache content is **automatically stored** when fetch methods are called:
  - `readResource(uri)` → stores in `this.cache.resourceContentCache.set(uri, {...})`
  - `readResourceFromTemplate(uriTemplate, params)` → stores in `this.cache.resourceTemplateContentCache.set(uriTemplate, {...})`
  - `getPrompt(name, args)` → stores in `this.cache.promptContentCache.set(name, {...})`
  - `callTool(name, args)` → stores in `this.cache.toolCallResultCache.set(name, {...})`
- There are **no explicit setter methods** on the cache object - content is set automatically by InspectorClient methods
- The cache object provides **read-only access** via getter methods and **clear methods** for cache management
- InspectorClient methods directly access the cache's internal maps to store content (the cache object owns the maps)

**Usage Pattern:**

```typescript
// Check cache first
const cached = client.cache.getResource(uri);
if (cached) {
  // Use cached content
} else {
  // Fetch fresh - automatically caches the result
  const content = await client.readResource(uri);
  // Content is now cached automatically (no need to call a setter)
}
```

### 7. Resource Content Management

**Methods:**

```typescript
/**
 * Read a resource and cache its content
 * @param uri - The URI of the resource to read
 * @param metadata - Optional metadata to include in the request
 * @returns The resource content
 */
async readResource(
  uri: string,
  metadata?: Record<string, string>,
): Promise<ReadResourceResult>;

/**
 * Read a resource from a template by expanding the template URI with parameters
 * This encapsulates the business logic of template expansion and associates the
 * loaded resource with its template in InspectorClient state
 * @param uriTemplate - The URI template string (unique identifier for the template)
 * @param params - Parameters to fill in the template variables
 * @param metadata - Optional metadata to include in the request
 * @returns The resource content along with expanded URI and uriTemplate
 * @throws Error if template is not found or URI expansion fails
 */
async readResourceFromTemplate(
  uriTemplate: string,
  params: Record<string, string>,
  metadata?: Record<string, string>,
): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
  uri: string; // The expanded URI
  uriTemplate: string; // The URI template for reference
}>;

```

**Implementation:**

- `readResource()`:
  1. Always fetch fresh content: Call `client.readResource(uri, metadata)` (SDK method)
  2. Store in cache using setter: `this.cache.setResource(uri, { contents, timestamp: new Date() })`
  3. Dispatch `resourceContentChange` event
  4. Return fresh content

- `readResourceFromTemplate()`:
  1. Look up template in `resourceTemplates` by `uriTemplate` (the unique identifier)
  2. If not found, throw error
  3. Expand the template's `uriTemplate` using the provided params
     - Use SDK's `UriTemplate` class: `new UriTemplate(uriTemplate).expand(params)`
  4. Always fetch fresh content: Call `this.readResource(expandedUri, metadata)` (InspectorClient method)
  5. Return response with expanded URI and uriTemplate (includes full response for backward compatibility)
  6. Note: Caching will be added in Phase 2 - for now, this method just encapsulates template expansion logic

**Resource Matching Logic:**

- **Regular resources** are cached by URI: `this.cache.resourceContentCache.set(uri, content)`
- **Resource templates** are cached by uriTemplate (the unique template ID): `this.cache.resourceTemplateContentCache.set(uriTemplate, content)`
- These are separate cache maps - no sharing between regular resources and template-based resources
- `client.cache.getResource(uri)` looks up in `resourceContentCache` by URI
- `client.cache.getResourceTemplate(uriTemplate)` looks up in `resourceTemplateContentCache` by uriTemplate (the unique template ID)
- If the same resource is loaded both ways (direct URI and via template), they are cached separately:
  - Direct: `readResource("file:///test.txt")` → cached in `resourceContentCache` by URI
  - Template: `readResourceFromTemplate("file", {path: "test.txt"})` → cached in `resourceTemplateContentCache` by uriTemplate

**Benefits:**

- Encapsulates template expansion logic in InspectorClient
- Allows InspectorClient to track which resources came from which templates
- Simplifies UI code - no need to manually expand templates
- Enables future features like template-based resource management

- `client.cache.getResource(uri)` (ContentCache method):
  - Accesses `this.resourceContentCache` map by URI
  - Returns cached content if present, `null` if not cached
  - Caller should check for `null` and call `client.readResource()` if fresh content is needed

- `client.cache.getResourceTemplate(uriTemplate)` (ContentCache method):
  - Looks up directly in `this.resourceTemplateContentCache` (owned by ContentCache) by uriTemplate
  - Returns cached template content with params if found, `null` if not cached
  - Note: Only one cached result per uriTemplate (most recent params combination replaces previous)

### 7. Prompt Content Management

**Methods:**

```typescript
/**
 * Get a prompt by name with optional arguments
 * @param name - Prompt name
 * @param args - Optional prompt arguments
 * @param metadata - Optional metadata to include in the request
 * @returns Prompt content
 */
async getPrompt(
  name: string,
  args?: Record<string, JsonValue>,
  metadata?: Record<string, string>,
): Promise<GetPromptResult>;


/**
 * Clear cached content for a prompt
 * @param name - The name of the prompt
 */
clearPromptContent(name: string): void;

/**
 * Clear all cached prompt content
 */
clearAllPromptContent(): void;
```

**Implementation:**

- `getPrompt()`:
  1. Convert args to strings (using existing `convertPromptArguments()`)
  2. Always fetch fresh content: Call `client.getPrompt(name, stringArgs, metadata)` (SDK method)
  3. Store in cache using setter: `this.cache.setPrompt(name, { messages, timestamp: new Date(), params: stringArgs })`
  4. Dispatch `promptContentChange` event
  5. Return fresh content

- `client.cache.getPrompt(name)` (ContentCache method):
  - Accesses `this.promptContentCache` map (owned by ContentCache) by prompt name
  - Returns cached content with stored `params` if present, `null` if not cached
  - Returns the most recent params combination that was used (only one cached per prompt)
  - Caller should check for `null` and call `client.getPrompt()` if fresh content is needed

**Prompt Matching Logic:**

- Prompts are matched by name only (one cached result per prompt)
- `client.cache.getPrompt(name)` returns the most recent content that was loaded for that prompt (with whatever params were used)
- If `getPrompt("weather", {city: "NYC"})` is called, then `getPrompt("weather", {city: "LA"})` is called:
  - Both calls fetch fresh content
  - The second call replaces the cached content (we cache only the most recent params combination per prompt)
- `client.cache.getPrompt("weather")` will return the content from the most recent call (with `params: {city: "LA"}`)

**Note:** We cache only the most recent params combination per prompt. Each call to `getPrompt()` fetches fresh content and replaces the cache.

### 8. Tool Call Result Management

**Methods:**

```typescript
/**
 * Call a tool by name with arguments
 * @param name - Tool name
 * @param args - Tool arguments
 * @param metadata - Optional metadata to include in the request
 * @returns Tool call response
 */
async callTool(
  name: string,
  args: Record<string, JsonValue>,
  generalMetadata?: Record<string, string>,
  toolSpecificMetadata?: Record<string, string>,
): Promise<CallToolResult>;

// Cache access via client.cache object:
// client.cache.getToolCallResult(toolName) - Returns ToolCallResult | null
// client.cache.clearToolCallResult(toolName) - Clears cached result for a tool
// client.cache.clearAll() - Clears all cached content
```

**Implementation:**

- `callTool()`:
  1. Call `client.callTool(name, args, metadata)` (existing implementation)
  2. On success:
     - Store result using setter: `this.cacheInternal.setToolCallResult(name, { toolName: name, params: args, result, timestamp: new Date(), success: true })`
     - Dispatch `toolCallResultChange` event
  3. On error:
     - Store error result using setter: `this.cacheInternal.setToolCallResult(name, { toolName: name, params: args, result: {}, timestamp: new Date(), success: false, error: error.message })`
     - Dispatch `toolCallResultChange` event
  4. Return result (existing behavior)

- `client.cache.getToolCallResult(toolName)`:
  - Look up in `toolCallResultCache` map by tool name
  - Return cached result if present, `null` if not cached
  - Caller should check for `null` and call `client.callTool()` if fresh result is needed

**Tool Call Result Matching:**

- Results are keyed by tool name only (one result per tool)
- Each new call to a tool replaces the previous cached result
- This matches typical UI patterns where users view one tool result at a time
- If needed, future enhancement could cache multiple param combinations per tool

**Note:** Tool call results are cached automatically when `callTool()` is invoked. There's no separate "cache" step - the result is always stored after each call.

### 9. Event Types

**New Events:**

- `resourceContentChange` - Fired when resource content is loaded or updated
  - Detail: `{ uri: string, content: {...}, timestamp: Date }`
- `resourceUpdated` - Fired when a subscribed resource is updated (but not yet reloaded)
  - Detail: `{ uri: string }`
- `resourceSubscriptionsChange` - Fired when subscription set changes
  - Detail: `string[]` (array of subscribed URIs)
- `promptContentChange` - Fired when prompt content is loaded or updated
  - Detail: `{ name: string, content: {...}, params?: Record<string, string>, timestamp: Date }`
- `toolCallResultChange` - Fired when a tool call completes (success or failure)
  - Detail: `{ toolName: string, params: Record<string, JsonValue>, result: {...}, timestamp: Date, success: boolean, error?: string }`

**Existing Events (enhanced):**

- `toolsChange` - Already exists, will be fired on listChanged
- `resourcesChange` - Already exists, will be fired on listChanged (preserves cached content)
- `promptsChange` - Already exists, will be fired on listChanged (preserves cached content)

## Implementation Plan

### Phase 1: Configuration and Infrastructure

1. Add `listChangedNotifications` options to `InspectorClientOptions` (tools, resources, prompts)
2. Add `subscribedResources: Set<string>` to class state
3. Update constructor to initialize new options
4. Add helper methods: `getSubscribedResources()`, `isSubscribedToResource()`, `supportsResourceSubscriptions()`

### Phase 2: Resource, Prompt, and Tool Call Result Caching

1. Create new module `shared/mcp/contentCache.ts`
2. Define type interfaces: `ResourceContentCache`, `ResourceTemplateContentCache`, `PromptContentCache`, `ToolCallResult`
3. Define `ReadOnlyContentCache` interface (getters and clear methods)
4. Define `ReadWriteContentCache` interface (extends ReadOnlyContentCache, adds setters)
5. Implement `ContentCache` class that implements `ReadWriteContentCache`
6. Update `InspectorClient` to:
   - Import `ContentCache` and `ReadOnlyContentCache` from `./contentCache`
   - Create `private cache: ContentCache` instance (full access)
   - Expose `public readonly cache: ReadOnlyContentCache` (read-only access)
7. Modify `readResource()` to use `this.cache.setResource()` after fetching
8. Add `readResourceFromTemplate()` helper method (expands template, reads resource, uses `this.cache.setResourceTemplate()`)
9. `getResources()` continues to return descriptors only (no changes needed)
10. Add `resourceContentChange` event
11. Modify `getPrompt()` to use `this.cacheInternal.setPrompt()` after fetching
12. `getPrompts()` continues to return descriptors only (no changes needed)
13. Add `promptContentChange` event
14. Modify `callTool()` to use `this.cacheInternal.setToolCallResult()` after each call
15. Add `toolCallResultChange` event

### Phase 3: ListChanged Notifications

1. Add `reloadToolsList()`, `reloadResourcesList()`, `reloadPromptsList()` helper methods
2. `reloadResourcesList()` should:
   - Reload resource descriptors from server
   - Preserve cached content in `resourceContentCache` for resources that still exist
   - Remove cached content for resources that no longer exist (cache cleanup)
3. `reloadPromptsList()` should:
   - Reload prompt descriptors from server
   - Preserve cached content in `promptContentCache` for prompts that still exist
   - Remove cached content for prompts that no longer exist (cache cleanup)
4. Set up notification handlers in `connect()` based on config
5. Test each handler independently

### Phase 4: Resource Subscriptions

1. Implement `subscribeToResource()` and `unsubscribeFromResource()` methods (check server capability)
2. Set up `notifications/resources/updated` handler (only if server supports subscriptions)
3. Implement auto-reload logic for subscribed resources (updates `resourceContentCache`)
4. Add `resourceSubscriptionsChange` event
5. Clear subscriptions and all cache maps (`resourceContentCache`, `promptContentCache`, `toolCallResultCache`) on disconnect

### Phase 5: Testing

1. Add tests for listChanged notifications (tools, resources, prompts)
2. Add tests for resource subscriptions (subscribe, unsubscribe, notifications)
3. Add tests for resource content caching (regular resources and template-based resources as separate types)
4. Add tests for prompt content caching (including params matching)
5. Add tests for tool call result caching (including success and error cases)
6. Add tests for resource updated notifications

## Questions and Considerations

### Q1: Should we auto-subscribe to resources when they're loaded?

**Current thinking:** No, subscriptions should be explicit. User/UI decides when to subscribe.

### Q2: Should we clear resource content on disconnect?

**Decision:** Yes, clear all cached content and subscriptions on disconnect to avoid stale data. This matches the behavior of clearing other lists (tools, resources, prompts) on disconnect.

### Q3: Should we support partial resource updates?

**Current thinking:** For now, reload entire resource content. Future enhancement could support partial updates if the protocol supports it.

### Q4: How should we handle resource content size limits?

**Current thinking:** No limits initially. If needed, add `maxResourceContentSize` option later.

### Q5: Should `readResource()` always fetch fresh content or use cache?

**Decision:** Always fetch fresh content. Cache is for display convenience. UX should check `client.cache.getResource()` first, and only call `client.readResource()` if fresh content is needed.

### Q7: Should we emit events for listChanged even if auto-reload fails?

**Current thinking:** Yes, emit the event but log the error. This allows UI to show that a change occurred even if reload failed.

### Q8: How should we handle multiple param combinations for the same prompt?

**Decision:** Cache only the most recent params combination per prompt. If a prompt is called with different params, replace the cached content. This keeps the implementation simple and matches typical UI usage patterns where users view one prompt at a time.

### Q7: Should we maintain subscription state across reconnects?

**Decision:** No, clear on disconnect. User/UI can re-subscribe after reconnect if needed.

## Open Questions

1. **Resource content invalidation:** Should we have a TTL for cached content? Or rely on subscriptions/notifications?
2. **Batch operations:** Should we support subscribing/unsubscribing to multiple resources at once?
3. **Error handling:** How should we handle subscription failures? Retry? Queue for later?
4. **Resource templates:** Should resource template list changes trigger resource list reload? (Probably yes)
5. **Resource list changed behavior:** When resources list changes, should we preserve cached content for resources that still exist? **Decision:** Yes, preserve cached content for existing resources, only clear content for resources that no longer exist in the list.

## Dependencies

- SDK types for notification schemas:
  - `ToolListChangedNotificationSchema`
  - `ResourceListChangedNotificationSchema`
  - `PromptListChangedNotificationSchema`
  - `ResourceUpdatedNotificationSchema`
- SDK methods:
  - `resources/subscribe`
  - `resources/unsubscribe`

## Backward Compatibility

- Existing event types remain unchanged
- New functionality is opt-in via configuration (defaults to enabled)
- No breaking changes to existing API
- Resource subscriptions are capability-driven (no config needed - client checks server capability)
- Resource, prompt, and tool call result caching is transparent - existing code continues to work, caching is automatic
