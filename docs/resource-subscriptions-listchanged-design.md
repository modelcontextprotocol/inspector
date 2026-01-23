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

**Invocation Types (defined in `shared/mcp/types.ts`, returned from methods and cached):**

```typescript
// For regular resources (cached by URI)
interface ResourceReadInvocation {
  result: ReadResourceResult; // The full SDK response object
  timestamp: Date; // When the call was made
  uri: string; // The URI that was read (request parameter)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

// For resource templates (cached by uriTemplate - the unique ID of the template)
interface ResourceTemplateReadInvocation {
  uriTemplate: string; // The URI template string (unique ID)
  expandedUri: string; // The expanded URI after template expansion
  result: ReadResourceResult; // The full SDK response object
  timestamp: Date; // When the call was made
  params: Record<string, string>; // The parameters used to expand the template (request parameters)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

// For prompts (cached by prompt name)
interface PromptGetInvocation {
  result: GetPromptResult; // The full SDK response object
  timestamp: Date; // When the call was made
  name: string; // The prompt name (request parameter)
  params?: Record<string, string>; // The parameters used when fetching the prompt (request parameters)
  metadata?: Record<string, string>; // Optional metadata that was passed
}

// For tool calls (cached by tool name)
interface ToolCallInvocation {
  toolName: string; // The tool that was called (request parameter)
  params: Record<string, JsonValue>; // The arguments passed to the tool (request parameters)
  result: CallToolResult | null; // The full SDK response object (null on error)
  timestamp: Date; // When the call was made
  success: boolean; // true if call succeeded, false if it threw
  error?: string; // Error message if success === false
  metadata?: Record<string, string>; // Optional metadata that was passed
}
```

**Rationale:**

- **Invocation objects** represent the complete call: request parameters + response + metadata
- These objects are **returned from InspectorClient methods** (e.g., `readResource()` returns `ResourceReadInvocation`)
- The **same object** is stored in the cache and returned from cache getters
- Keep SDK response objects intact (`ReadResourceResult`, `GetPromptResult`, `CallToolResult`) rather than breaking them apart
- Add our metadata fields (`timestamp`, request params, `uriTemplate`, `expandedUri`, `success`, `error`) alongside the SDK result
- Preserves all SDK fields and makes it easier to maintain if SDK types change
- Clear separation between SDK data and our cache metadata
- For tool calls, `result` is `null` on error to distinguish from successful calls with empty results
- **Consistency**: The object returned from `client.readResource(uri)` is the same object you'd get from `client.cache.getResource(uri)` (if cached)
- **Type Location**: These types are defined in `shared/mcp/types.ts` since they're shared between `InspectorClient` and `ContentCache` (following the established pattern where shared MCP types live in `types.ts`)

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
interface PromptGetInvocation {
  result: GetPromptResult; // The full SDK response object
  timestamp: Date; // When the call was made
  name: string; // The prompt name (request parameter)
  params?: Record<string, string>; // The parameters used when fetching the prompt (request parameters)
  metadata?: Record<string, string>; // Optional metadata that was passed
}
```

**Rationale:**

- Keep SDK response object intact (`GetPromptResult`) rather than extracting `messages`
- Add our metadata fields (`timestamp`, `params`) alongside the SDK result
- Preserves all SDK fields including optional `description` and `_meta`

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
- `notifications/resources/list_changed` → reload resources list and resource templates list (preserve cached content for existing items)
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
2. If subscribed:
   - Clear the resource from cache using `this.cacheInternal.clearResourceAndResourceTemplate(uri)`
   - This method clears both regular resources cached by URI and resource templates with matching `expandedUri`
   - Dispatch `resourceUpdated` event to notify UI that the resource has changed
3. If not subscribed:
   - Ignore the notification (no action needed)

**Event:**

```typescript
// New event type
interface ResourceUpdatedEvent extends CustomEvent {
  detail: {
    uri: string;
  };
}
```

**Note:** The cache's `clearResourceAndResourceTemplate()` method handles clearing both regular resources and resource templates that match the URI, so the handler doesn't need to check multiple cache types.

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
client.cache.clearResourceAndResourceTemplate(uri); // Clears both regular resources and resource templates with matching expandedUri
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
  private cacheInternal: ContentCache; // Full access for InspectorClient
  public readonly cache: ReadOnlyContentCache; // Read-only access for users

  constructor(...) {
    // Create integrated cache object
    this.cacheInternal = new ContentCache();
    this.cache = this.cacheInternal; // Expose read-only interface
  }
}
```

**Note:** The `ContentCache` class is already implemented in `shared/mcp/contentCache.ts` with all getter, setter, and clear methods for resources, resource templates, prompts, and tool call results.

**Cache Storage:**

- Cache content is **automatically stored** when fetch methods are called (in Phase 2):
  - `readResource(uri)` → stores via `this.cacheInternal.setResource(uri, invocation)`
  - `readResourceFromTemplate(uriTemplate, params)` → stores via `this.cacheInternal.setResourceTemplate(uriTemplate, invocation)`
  - `getPrompt(name, args)` → stores via `this.cacheInternal.setPrompt(name, invocation)`
  - `callTool(name, args)` → stores via `this.cacheInternal.setToolCallResult(name, invocation)`
- The cache object provides **read-only access** via getter methods and **clear methods** for cache management
- InspectorClient uses `cacheInternal` (full access) to store content, and exposes `cache` (read-only) to users

**Usage Pattern:**

```typescript
// Check cache first
const cached = client.cache.getResource(uri);
if (cached) {
  // Use cached content - cached is a ResourceReadInvocation
  // Access content via cached.result.contents
  // Same object that would be returned from readResource()
} else {
  // Fetch fresh - automatically caches the result
  const invocation = await client.readResource(uri);
  // invocation is a ResourceReadInvocation (same object now in cache)
  // Access content via invocation.result.contents
  // client.cache.getResource(uri) would now return the same invocation object
}
```

### 7. Resource Content Management

**Methods:**

```typescript
/**
 * Read a resource and cache its content
 * @param uri - The URI of the resource to read
 * @param metadata - Optional metadata to include in the request
 * @returns Resource read invocation (includes result, timestamp, request params)
 */
async readResource(
  uri: string,
  metadata?: Record<string, string>,
): Promise<ResourceReadInvocation>;

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
): Promise<ResourceTemplateReadInvocation>;

```

**Implementation:**

- `readResource()`:
  1. Always fetch fresh content: Call `client.readResource(uri, metadata)` (SDK method) → returns `ReadResourceResult`
  2. Create invocation object: `const invocation: ResourceReadInvocation = { result, timestamp: new Date(), uri, metadata }`
  3. Store in cache: `this.cacheInternal.setResource(uri, invocation)`
  4. Dispatch `resourceContentChange` event
  5. Return the invocation object (same object that's in the cache)

- `readResourceFromTemplate()`:
  1. Look up template in `resourceTemplates` by `uriTemplate` (the unique identifier)
  2. If not found, throw error
  3. Expand the template's `uriTemplate` using the provided params
     - Use SDK's `UriTemplate` class: `new UriTemplate(uriTemplate).expand(params)`
  4. Always fetch fresh content: Call `this.readResource(expandedUri, metadata)` (InspectorClient method) → returns `ResourceReadInvocation`
  5. Create invocation object: `const invocation: ResourceTemplateReadInvocation = { uriTemplate, expandedUri, result: readInvocation.result, timestamp: readInvocation.timestamp, params, metadata }`
  6. Store in cache: `this.cacheInternal.setResourceTemplate(uriTemplate, invocation)` (TODO: add in Phase 2)
  7. Dispatch `resourceTemplateContentChange` event (TODO: add in Phase 2)
  8. Return the invocation object (same object that's in the cache)

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
  - Returns cached `ResourceReadInvocation` object (same type as returned from `readResource()`), `null` if not cached
  - Caller should check for `null` and call `client.readResource()` if fresh content is needed
  - Access resource contents via `cached.result.contents`
  - **Note**: The returned object is the same object that was returned from `readResource()` (object identity preserved)

- `client.cache.getResourceTemplate(uriTemplate)` (ContentCache method):
  - Looks up directly in `this.resourceTemplateContentCache` (owned by ContentCache) by uriTemplate
  - Returns cached `ResourceTemplateReadInvocation` object (same type as returned from `readResourceFromTemplate()`), `null` if not cached
  - Access resource contents via `cached.result.contents`
  - Returns cached template content with params if found, `null` if not cached
  - Note: Only one cached result per uriTemplate (most recent params combination replaces previous)
  - **Note**: The returned object is the same object that was returned from `readResourceFromTemplate()` (object identity preserved)

### 7. Prompt Content Management

**Methods:**

```typescript
/**
 * Get a prompt by name with optional arguments
 * @param name - Prompt name
 * @param args - Optional prompt arguments
 * @param metadata - Optional metadata to include in the request
 * @returns Prompt get invocation (includes result, timestamp, request params)
 */
async getPrompt(
  name: string,
  args?: Record<string, JsonValue>,
  metadata?: Record<string, string>,
): Promise<PromptGetInvocation>;


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
  2. Always fetch fresh content: Call `client.getPrompt(name, stringArgs, metadata)` (SDK method) → returns `GetPromptResult`
  3. Create invocation object: `const invocation: PromptGetInvocation = { result, timestamp: new Date(), name, params: stringArgs, metadata }`
  4. Store in cache: `this.cacheInternal.setPrompt(name, invocation)` (TODO: add in Phase 2)
  5. Dispatch `promptContentChange` event (TODO: add in Phase 2)
  6. Return the invocation object (same object that's in the cache)

- `client.cache.getPrompt(name)` (ContentCache method):
  - Accesses `this.promptContentCache` map (owned by ContentCache) by prompt name
  - Returns cached `PromptGetInvocation` object (same type as returned from `getPrompt()`), `null` if not cached
  - Returns the most recent params combination that was used (only one cached per prompt)
  - Caller should check for `null` and call `client.getPrompt()` if fresh content is needed
  - Access prompt messages via `cached.result.messages`, description via `cached.result.description`
  - **Note**: The returned object is the same object that was returned from `getPrompt()` (object identity preserved)

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
 * @returns Tool call invocation (includes result, timestamp, request params, success/error)
 */
async callTool(
  name: string,
  args: Record<string, JsonValue>,
  generalMetadata?: Record<string, string>,
  toolSpecificMetadata?: Record<string, string>,
): Promise<ToolCallInvocation>;

// Cache access via client.cache object:
// client.cache.getToolCallResult(toolName) - Returns ToolCallInvocation | null (same object as returned from callTool())
// client.cache.clearToolCallResult(toolName) - Clears cached result for a tool
// client.cache.clearAll() - Clears all cached content
```

**Implementation:**

- `callTool()`:
  1. Call `client.callTool(name, args, metadata)` (SDK method) → returns `CallToolResult` on success, throws on error
  2. On success:
     - Create invocation object: `const invocation: ToolCallInvocation = { toolName: name, params: args, result, timestamp: new Date(), success: true, metadata }`
     - Store in cache: `this.cacheInternal.setToolCallResult(name, invocation)`
     - Dispatch `toolCallResultChange` event
     - Return the invocation object (same object that's in the cache)
  3. On error:
     - Create invocation object: `const invocation: ToolCallInvocation = { toolName: name, params: args, result: null, timestamp: new Date(), success: false, error: error.message, metadata }`
     - Store in cache: `this.cacheInternal.setToolCallResult(name, invocation)`
     - Dispatch `toolCallResultChange` event
     - Return the invocation object (same object that's in the cache)

- `client.cache.getToolCallResult(toolName)`:
  - Look up in `toolCallResultCache` map by tool name
  - Return cached `ToolCallInvocation` object (same type as returned from `callTool()`), `null` if not cached
  - Caller should check for `null` and call `client.callTool()` if fresh result is needed
  - Access tool result content via `cached.result?.content` (if `success === true`)
  - **Note**: The returned object is the same object that was returned from `callTool()` (object identity preserved)

**Tool Call Result Matching:**

- Results are keyed by tool name only (one result per tool)
- Each new call to a tool replaces the previous cached result
- This matches typical UI patterns where users view one tool result at a time
- If needed, future enhancement could cache multiple param combinations per tool

**Note:** Tool call results are cached automatically when `callTool()` is invoked. There's no separate "cache" step - the result is always stored after each call.

### 9. Event Types

**New Events:**

- `resourceContentChange` - Fired when regular resource content is loaded or updated
  - Detail: `{ uri: string, content: {...}, timestamp: Date }`
- `resourceTemplateContentChange` - Fired when resource template content is loaded or updated
  - Detail: `{ uriTemplate: string, expandedUri: string, content: {...}, params: Record<string, string>, timestamp: Date }`
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

### Phase 1: Integrate ContentCache into InspectorClient (Infrastructure Only)

**Note:** The `ContentCache` module has been implemented and tested. It provides `ReadOnlyContentCache` and `ReadWriteContentCache` interfaces, and the `ContentCache` class with get/set/clear methods for all cache types.

**Goal:** Add ContentCache to InspectorClient without changing existing behavior.

**Deliverables:**

1. Import `ContentCache` and `ReadOnlyContentCache` from `./contentCache.js` in `InspectorClient`
2. Import invocation types (`ResourceReadInvocation`, `ResourceTemplateReadInvocation`, `PromptGetInvocation`, `ToolCallInvocation`) from `./types.js` in `InspectorClient`
3. Add `private cacheInternal: ContentCache` property
4. Add `public readonly cache: ReadOnlyContentCache` property
5. Initialize cache in constructor
6. Clear all cache maps on disconnect (in `disconnect()` method)

**Testing:**

- Verify `client.cache` is accessible and returns `null` for all getters initially
- Verify cache is cleared when `disconnect()` is called
- Verify no breaking changes to existing API
- All existing tests pass (no regressions)

**Acceptance Criteria:**

- `client.cache` is accessible and functional
- Cache is cleared on disconnect
- No breaking changes to existing API
- All existing tests pass

**Rationale:** Separating infrastructure from functionality allows validation that the integration doesn't break anything before adding caching behavior.

---

### Phase 2: Implement All Caching Types

**Goal:** Add caching to all fetch methods (resources, templates, prompts, tool results) simultaneously.

**Deliverables:**

1. Modify `readResource()` to:
   - Keep existing behavior (always fetch fresh)
   - Store in cache: `this.cacheInternal.setResource(uri, { result, timestamp })`
   - Dispatch `resourceContentChange` event
2. Modify `readResourceFromTemplate()` to:
   - Store in cache: `this.cacheInternal.setResourceTemplate(uriTemplate, invocation)`
   - Dispatch `resourceTemplateContentChange` event
3. Modify `getPrompt()` to:
   - Store in cache: `this.cacheInternal.setPrompt(name, invocation)`
   - Dispatch `promptContentChange` event
4. Modify `callTool()` to:
   - On success: Store in cache: `this.cacheInternal.setToolCallResult(name, invocation)` (invocation with `success: true`)
   - On error: Store in cache: `this.cacheInternal.setToolCallResult(name, invocation)` (invocation with `success: false` and error)
   - Dispatch `toolCallResultChange` event
5. Add new event types:
   - `resourceContentChange`
   - `resourceTemplateContentChange`
   - `promptContentChange`
   - `toolCallResultChange`

**Testing:**

- Test that each fetch method stores content in cache
- Test that `client.cache.get*()` methods return cached content
- Test that events are dispatched with correct detail structure
- Test that cache persists across multiple calls
- Test that subsequent calls replace cache entries
- Test error handling (tool call failures)

**Acceptance Criteria:**

- All fetch methods continue to work as before (no breaking changes)
- Content is stored in cache after each fetch operation
- Cache getters return cached content correctly
- Events are dispatched with correct detail structure
- All existing tests pass

**Rationale:** Implementing all cache types together is efficient since they follow the same pattern. The cache module is already tested, so this phase focuses on integration.

---

### Phase 3: Configuration and Subscription Infrastructure

**Goal:** Add configuration options and subscription state management (no handlers yet).

**Deliverables:**

1. Add `listChangedNotifications` option to `InspectorClientOptions` (tools, resources, prompts)
2. Add `private subscribedResources: Set<string>` to InspectorClient
3. Add helper methods:
   - `getSubscribedResources(): string[]`
   - `isSubscribedToResource(uri: string): boolean`
   - `supportsResourceSubscriptions(): boolean`
4. Initialize options in constructor
5. Clear subscriptions on disconnect

**Testing:**

- Test that `listChangedNotifications` options are initialized correctly
- Test that subscription helper methods work
- Test that subscriptions are cleared on disconnect
- Test that `supportsResourceSubscriptions()` checks server capability

**Acceptance Criteria:**

- Configuration options are accessible and initialized correctly
- Subscription state is managed correctly
- Helper methods return correct values
- No breaking changes to existing API

**Rationale:** Setting up infrastructure before implementing features allows for cleaner separation of concerns and easier testing.

---

### Phase 4: ListChanged Notification Handlers

**Goal:** Add handlers for listChanged notifications that reload lists and preserve cache.

**Deliverables:**

1. Modify existing `list*()` methods to:
   - Update internal state (`this.tools`, `this.resources`, `this.resourceTemplates`, `this.prompts`)
   - Clean up cache entries for items no longer in the list
   - Dispatch change events (`toolsChange`, `resourcesChange`, `resourceTemplatesChange`, `promptsChange`)
   - Return the fetched arrays (maintain existing API)
2. Set up notification handlers in `connect()` based on config:
   - `notifications/tools/list_changed` → Call `await this.listTools()` (which handles state update, cache cleanup, and event dispatch)
   - `notifications/resources/list_changed` → Call both `await this.listResources()` and `await this.listResourceTemplates()` (both handle state update, cache cleanup, and event dispatch)
   - `notifications/prompts/list_changed` → Call `await this.listPrompts()` (which handles state update, cache cleanup, and event dispatch)
   - Note: Resource templates are part of the resources capability, so `notifications/resources/list_changed` should reload both resources and resource templates
3. Import notification schemas from SDK:
   - `ToolListChangedNotificationSchema`
   - `ResourceListChangedNotificationSchema`
   - `PromptListChangedNotificationSchema`

**Implementation Details:**

- Modify `listResources()` to:
  1. Fetch from server: `const newResources = await this.client.listResources(params)`
  2. Compare `newResources` with `this.resources` to find removed URIs
  3. For each removed URI, call `this.cacheInternal.clearResource(uri)` (cache cleanup)
  4. Update `this.resources = newResources`
  5. Dispatch `resourcesChange` event
  6. Return `newResources` (maintain existing API)
  7. Note: Cached content for existing resources is automatically preserved (cache is not cleared unless explicitly removed)
- Modify `listPrompts()` to:
  1. Fetch from server: `const newPrompts = await this.client.listPrompts(params)`
  2. Compare `newPrompts` with `this.prompts` to find removed prompt names
  3. For each removed prompt name, call `this.cacheInternal.clearPrompt(name)` (cache cleanup)
  4. Update `this.prompts = newPrompts`
  5. Dispatch `promptsChange` event
  6. Return `newPrompts` (maintain existing API)
  7. Note: Cached content for existing prompts is automatically preserved
- Modify `listResourceTemplates()` to:
  1. Fetch from server: `const newTemplates = await this.client.listResourceTemplates(params)`
  2. Compare `newTemplates` with `this.resourceTemplates` to find removed `uriTemplate` values
  3. For each removed `uriTemplate`, call `this.cacheInternal.clearResourceTemplate(uriTemplate)` (cache cleanup)
  4. Update `this.resourceTemplates = newTemplates`
  5. Dispatch `resourceTemplatesChange` event
  6. Return `newTemplates` (maintain existing API)
  7. Note: Cached content for existing templates is automatically preserved (cache is not cleared unless explicitly removed)
- Modify `listTools()` to:
  1. Fetch from server: `const newTools = await this.client.listTools(params)`
  2. Update `this.tools = newTools`
  3. Dispatch `toolsChange` event
  4. Return `newTools` (maintain existing API)
  5. Note: Tool call result cache is not cleaned up (results persist even if tool is removed)
- Notification handlers are thin wrappers that just call the `list*()` methods
- Update `fetchServerContents()` to remove duplicate state update and event dispatch logic:
  - Change `this.resources = await this.listResources(); this.dispatchEvent(...)` to just `await this.listResources()`
  - Change `this.resourceTemplates = await this.listResourceTemplates(); this.dispatchEvent(...)` to just `await this.listResourceTemplates()`
  - Change `this.prompts = await this.listPrompts(); this.dispatchEvent(...)` to just `await this.listPrompts()`
  - Change `this.tools = await this.listTools(); this.dispatchEvent(...)` to just `await this.listTools()`
  - The list methods now handle state updates and event dispatching internally

**Testing:**

- Test that `listResources()` updates `this.resources` and dispatches `resourcesChange` event
- Test that `listResources()` cleans up cache for removed resources
- Test that `listResources()` preserves cache for existing resources
- Test that `listResourceTemplates()` updates `this.resourceTemplates` and dispatches `resourceTemplatesChange` event
- Test that `listResourceTemplates()` cleans up cache for removed templates (by `uriTemplate`)
- Test that `listResourceTemplates()` preserves cache for existing templates
- Test that `listPrompts()` updates `this.prompts` and dispatches `promptsChange` event
- Test that `listPrompts()` cleans up cache for removed prompts
- Test that `listPrompts()` preserves cache for existing prompts
- Test that `listTools()` updates `this.tools` and dispatches `toolsChange` event
- Test that notification handlers call the correct `list*()` methods
- Test that handlers respect configuration (can be disabled)
- Test that `list*()` methods still return arrays (backward compatibility)
- Test with test server that sends listChanged notifications

**Acceptance Criteria:**

- All three notification types are handled
- Lists are reloaded when notifications are received
- Cached content is preserved for existing items
- Cached content is cleared for removed items
- Events are dispatched correctly
- Configuration controls handler setup

**Rationale:** This phase depends on Phase 2 (caching) to test cache preservation behavior. The cache infrastructure is already in place, so this focuses on notification handling.

---

### Phase 5: Resource Subscriptions

**Goal:** Add subscribe/unsubscribe methods and handle resource updated notifications.

**Deliverables:**

1. Implement `subscribeToResource(uri: string)`:
   - Check server capability: `this.capabilities?.resources?.subscribe === true`
   - Call `client.request({ method: "resources/subscribe", params: { uri } })`
   - Add to `subscribedResources` Set
   - Dispatch `resourceSubscriptionsChange` event
2. Implement `unsubscribeFromResource(uri: string)`:
   - Call `client.request({ method: "resources/unsubscribe", params: { uri } })`
   - Remove from `subscribedResources` Set
   - Dispatch `resourceSubscriptionsChange` event
3. Set up `notifications/resources/updated` handler in `connect()` (only if server supports subscriptions)
4. Handler logic:
   - Check if resource is subscribed
   - If subscribed: Clear cache using `this.cacheInternal.clearResourceAndResourceTemplate(uri)` (clears both regular resources and resource templates with matching expandedUri)
   - Dispatch `resourceUpdated` event to notify UI
5. Add event types:
   - `resourceSubscriptionsChange`
   - `resourceUpdated`

**Testing:**

- Test that `subscribeToResource()` calls SDK method correctly
- Test that `unsubscribeFromResource()` calls SDK method correctly
- Test that subscription state is tracked correctly
- Test that `resourceSubscriptionsChange` event is dispatched
- Test that handler only processes subscribed resources
- Test that cached resources are cleared from cache (both regular resources and resource templates with matching expandedUri)
- Test that `resourceUpdated` event is dispatched when resource is cleared
- Test that subscription fails gracefully if server doesn't support it
- Test with test server that supports subscriptions and sends resource updated notifications

**Acceptance Criteria:**

- Subscribe/unsubscribe methods work correctly
- Subscription state is tracked
- Resource updated notifications are handled correctly
- Cached resources are cleared from cache (both regular resources and resource templates)
- Events are dispatched correctly
- Graceful handling of unsupported servers
- No breaking changes to existing API

**Rationale:** This phase depends on Phase 2 (resource caching) for cache clearing functionality. The subscription infrastructure from Phase 3 is already in place.

---

### Phase 6: Integration Testing and Documentation

**Goal:** Comprehensive testing, edge case handling, and documentation updates.

**Deliverables:**

1. Integration tests covering:
   - Full workflow: subscribe → receive update → cache cleared
   - ListChanged notifications for all types
   - Cache persistence across list reloads
   - Cache clearing on disconnect
   - Multiple resource subscriptions
   - Error scenarios (subscription failures, cache failures)
2. Edge case testing:
   - Empty lists
   - Rapid notifications
   - Disconnect during operations
   - Server capability changes
3. Update documentation:
   - API documentation for new methods
   - Event documentation for new events
   - Usage examples
   - Update feature gaps document
4. Code review and cleanup

**Testing:**

- Run full test suite
- Test with real MCP servers (if available)
- Test edge cases
- Performance testing (if applicable)

**Acceptance Criteria:**

- All tests pass
- Documentation is complete and accurate
- No regressions in existing functionality
- Code is ready for review
- Edge cases are handled gracefully

**Rationale:** Final validation phase ensures everything works together correctly and documentation is complete.

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
