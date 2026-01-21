# V2 Storage Specification

**Status:** Draft
**Issue:** [#983](https://github.com/modelcontextprotocol/inspector/issues/983)
**Last Updated:** 2026-01-19

## Overview

This specification defines the storage and state management architecture for Inspector V2. It addresses how data is persisted, where state lives, and which libraries manage it.

## Design Principles

1. **Interface-first** - Repository/service interfaces remain storage-agnostic
2. **Core stays React-free** - No React dependencies in `@modelcontextprotocol/inspector-core`
3. **Hybrid approach** - Different state management for different concerns
4. **Server configs via proxy** - Per [#1805](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1805), NOT browser localStorage

---

## State Categories

| Category | Examples | Persistence | Location |
|----------|----------|-------------|----------|
| **Server Configurations** | URL, transport, headers | File (mcp.json) | Proxy server |
| **User Preferences** | Theme, log level, panel sizes | localStorage | Browser |
| **Connection State** | Status, server info, errors | Memory | React Context |
| **Execution State** | Current request, pending queue | Memory | React Context |
| **Logs Display** | Filtered view, pause state | Memory | Zustand store |
| **Execution Form State** | Selected tool, form values | Memory | Zustand store |
| **Testing Profiles** | Custom profiles, active selection | localStorage | Zustand store |
| **History Data** | Request/response records | NDJSON file (Pino) | Proxy server |

### Server-Side vs Client-Side Storage

This spec focuses on **client-side** state management. Server-side persistence uses a different stack:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Proxy (Pino)** | NDJSON files | Raw history persistence (`history.ndjson`), parsed by History API |
| **Client (Zustand)** | localStorage + memory | UI state, display buffers, user preferences |

The Pino logger on the proxy writes MCP request/response records to NDJSON format. The History API endpoint parses this file and returns filtered JSON. Client-side Zustand stores handle:
- How logs are **displayed** (filters, pause, auto-scroll)
- Caching fetched history for UI performance
- User preferences that don't belong on the server

See [v2_tech_stack.md](./v2_tech_stack.md#pino-rationale) for Pino configuration details.

---

## State Management Options Analysis

### Comparison Matrix

| Criteria | Zustand | Redux/RTK | Jotai | Context+useReducer | TanStack Query | Valtio |
|----------|---------|-----------|-------|-------------------|----------------|--------|
| **Bundle Size** | ~1.2KB | ~11KB | ~2.2KB | 0 (built-in) | ~13KB | ~3KB |
| **Learning Curve** | Low | Medium-High | Low | Low | Medium | Low |
| **Boilerplate** | Minimal | High | Minimal | Medium | Low | Minimal |
| **DevTools** | Yes | Excellent | Yes | React DevTools | Yes | Yes |
| **Persist Middleware** | Built-in | RTK-persist | Yes | Manual | N/A | Yes |
| **React-free Usage** | Yes (`/vanilla`) | No | No | No | No | Yes |
| **TypeScript Support** | Excellent | Excellent | Good | Good | Excellent | Good |
| **Selector Optimization** | Built-in | Requires memoization | Automatic | Manual | Automatic | Automatic |

### Detailed Analysis

#### Zustand (Recommended for UI State)

**Pros:**
- Minimal boilerplate - no actions, reducers, or providers for simple stores
- Built-in `persist` middleware for automatic localStorage synchronization
- Selector-based access prevents unnecessary re-renders
- React-independent core (`zustand/vanilla`) supports CLI/TUI reuse
- Excellent TypeScript inference without verbose type annotations
- MCPJam Inspector precedent demonstrates proven patterns in comparable application

**Cons:**
- Less structured than Redux for complex state transitions
- No built-in time-travel debugging (devtools extension available)
- Multiple stores can fragment state if not carefully organized

**Verdict:** Recommended for user preferences, logs display, execution form state, testing profiles

#### Redux / Redux Toolkit

**Pros:**
- Excellent DevTools with time-travel debugging
- Very structured, predictable state updates via reducers
- Large ecosystem and community support
- RTK simplifies traditional Redux boilerplate significantly

**Cons:**
- Heavy bundle size (11KB) for Inspector's scope
- Overkill for single-server connection model
- Requires React bindings (`react-redux`) - violates React-free core
- Higher cognitive overhead for simple state

**Verdict:** Rejected - overkill for Inspector's requirements

#### Jotai

**Pros:**
- Atomic state model enables granular updates
- Minimal re-renders by design
- Good for derived/computed state
- Suspense integration for async state

**Cons:**
- Less intuitive for imperative state updates
- Smaller ecosystem than Zustand

**Verdict:** Good alternative, but less proven in MCP tooling context

#### Context + useReducer

**Pros:**
- No additional dependencies (built into React)
- Clear action-based state transitions
- Familiar pattern for React developers
- Good for truly global, infrequently-updated state

**Cons:**
- Re-renders all consumers on any state change without careful splitting
- Manual selector optimization required (useMemo, useCallback)
- Verbose for multiple state domains
- No built-in persistence

**Verdict:** Keep for connection/execution state machines (already implemented)

#### TanStack Query (React Query)

**Pros:**
- Excellent for server state caching and synchronization
- Built-in caching, background refetch, optimistic updates
- Devtools for debugging async state
- Handles loading/error states elegantly

**Cons:**
- Designed for async server state, not client UI state
- Not appropriate for local-only state like preferences
- Additional complexity for Inspector's proxy-mediated data fetching

**Verdict:** Consider as complement for History/Logs API calls when repository uses proxy

#### Valtio

**Pros:**
- Proxy-based mutable API feels natural for imperative updates
- Automatic re-render optimization
- Can be used outside React

**Cons:**
- Proxy "magic" can be confusing for debugging
- Less explicit state updates than Zustand
- Smaller community adoption

**Verdict:** Viable alternative, but proxy semantics less familiar to team

---

## Recommended Architecture

### Hybrid Approach

| State Domain | Technology | Justification |
|--------------|------------|---------------|
| **Connection State** | useReducer + Context | Clear state machine (disconnected -> connecting -> connected -> error); already implemented in McpContext |
| **Execution State** | useReducer + Context | Complex transitions with pending requests; already implemented in ExecutionContext |
| **User Preferences** | Zustand + persist | Simple key-value; needs persistence; avoids prop drilling |
| **Logs Display** | Zustand | Real-time buffer; filter state; pause/resume |
| **Execution Forms** | Zustand | Form values; selected items; response history |
| **Testing Profiles** | Zustand + persist | User configurations; active selection |
| **Server Configs** | Repository (proxy API) | Per spec constraint; not browser storage |
| **History Data** | Repository interface | Storage implementation deferred |

### Why NOT Replace useReducer for Connection State?

Connection state is a **clear state machine** with well-defined transitions:

```
disconnected -> connecting -> connected -> error
     ^                            |          |
     |____________________________|__________|
```

`useReducer` excels at action-based transitions:
- `CONNECT_REQUEST` - Begin connection attempt
- `CONNECT_SUCCESS` - Store server info, capabilities
- `CONNECT_ERROR` - Store error details
- `DISCONNECT` - Clean up and reset

This pattern is already implemented in `McpContext.tsx` and working well. No migration needed.

---

## Zustand Store Specifications

### 1. Preferences Store

**Purpose:** Persist user preferences across sessions

**Persistence:** localStorage via `persist` middleware

```typescript
interface PreferencesState {
  // Theme
  theme: 'light' | 'dark' | 'system';

  // Logging
  logLevel: LogLevel;
  showTimestamps: boolean;
  wrapLogLines: boolean;

  // Display
  compactMode: boolean;
  showAnnotations: boolean;

  // Layout
  logsExpanded: boolean;
  historySidebarWidth: number;
}

interface PreferencesActions {
  setTheme: (theme: PreferencesState['theme']) => void;
  setLogLevel: (level: LogLevel) => void;
  toggleTimestamps: () => void;
  toggleWrapLines: () => void;
  toggleCompactMode: () => void;
  toggleAnnotations: () => void;
  setLogsExpanded: (expanded: boolean) => void;
  setHistorySidebarWidth: (width: number) => void;
  resetToDefaults: () => void;
}
```

**localStorage key:** `inspector-preferences`

### 2. Logs Display Store

**Purpose:** Manage real-time log display state

**Persistence:** None (ephemeral)

```typescript
interface LogsDisplayState {
  // Buffer (in-memory only)
  entries: LogEntry[];

  // Filters
  minLevel: LogLevel;
  loggerFilter: string | null;
  requestIdFilter: string | null;
  searchQuery: string;

  // Controls
  isPaused: boolean;
  isAutoScroll: boolean;
}

interface LogsDisplayActions {
  addEntry: (entry: LogEntry) => void;
  addBatch: (entries: LogEntry[]) => void;
  clearLogs: () => void;

  setMinLevel: (level: LogLevel) => void;
  setLoggerFilter: (logger: string | null) => void;
  setRequestIdFilter: (requestId: string | null) => void;
  setSearchQuery: (query: string) => void;

  togglePause: () => void;
  toggleAutoScroll: () => void;
}
```

**Memory cap:** 1000 entries (FIFO eviction)

### 3. Execution Form Store

**Purpose:** Track tool/resource/prompt execution form state

**Persistence:** None (ephemeral)

```typescript
interface ExecutionFormState {
  // Tools
  selectedToolName: string | null;
  toolFormValues: Record<string, unknown>;
  toolResponseHistory: ToolResponse[];

  // Resources
  selectedResourceUri: string | null;
  resourceContent: unknown | null;

  // Prompts
  selectedPromptName: string | null;
  promptFormValues: Record<string, string>;
  promptMessages: unknown[] | null;
}

interface ToolResponse {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  duration: number;
  isError: boolean;
}

interface ExecutionFormActions {
  selectTool: (name: string | null) => void;
  setToolFormValues: (values: Record<string, unknown>) => void;
  addToolResponse: (response: ToolResponse) => void;
  clearToolHistory: () => void;

  selectResource: (uri: string | null) => void;
  setResourceContent: (content: unknown | null) => void;

  selectPrompt: (name: string | null) => void;
  setPromptFormValues: (values: Record<string, string>) => void;
  setPromptMessages: (messages: unknown[] | null) => void;

  reset: () => void;
}
```

**History cap:** 50 tool responses

### 4. Testing Profiles Store

**Purpose:** Manage sampling/elicitation response configurations

**Persistence:** localStorage via `persist` middleware

```typescript
interface TestingProfilesState {
  profiles: TestingProfile[];
  activeProfileId: string;
}

interface TestingProfilesActions {
  setActiveProfile: (id: string) => void;
  addProfile: (profile: Omit<TestingProfile, 'id'>) => TestingProfile;
  updateProfile: (id: string, updates: Partial<TestingProfile>) => void;
  deleteProfile: (id: string) => void;
  resetToDefaults: () => void;
}
```

**localStorage key:** `inspector-testing-profiles`

**Default profiles:**
1. **Manual** - Respond to requests manually (no auto-approve)
2. **Auto-Approve** - Automatically approve with default response

---

## Integration with Core Package

### Repository Interface Pattern

Zustand stores in the client package **wrap** core repository interfaces, not replace them:

```typescript
// client/src/stores/historyStore.ts
import type { HistoryRepository } from '@modelcontextprotocol/inspector-core';

export function createHistoryStore(repository: HistoryRepository) {
  return create<HistoryStoreState>((set, get) => ({
    entries: [],
    isLoading: false,

    fetch: async () => {
      set({ isLoading: true });
      const entries = await repository.list();
      set({ entries, isLoading: false });
    },

    add: async (entry) => {
      const added = await repository.add(entry);
      set((s) => ({ entries: [added, ...s.entries] }));
      return added;
    },
    // ... other methods delegate to repository
  }));
}
```

This pattern:
- Keeps core interfaces unchanged
- Allows swapping repository implementations (memory, proxy API, file)
- Provides reactive state for UI components
- Maintains testability with memory stubs

### Dependency Flow

```
+------------------------------------------------------------------+
|                        Client Package                             |
|                                                                   |
|  +------------------+    +---------------------+                  |
|  | Zustand Stores   |    | Context Providers   |                  |
|  |  - preferences   |    |  - McpContext       |                  |
|  |  - logsDisplay   |    |  - ExecutionContext |                  |
|  |  - executionForm |    +---------------------+                  |
|  |  - testingProfiles      |                                      |
|  +--------+---------+      |                                      |
|           |                |                                      |
|           v                v                                      |
|  +--------------------------------------------------------+      |
|  |              Core Package Interfaces                    |      |
|  |  - ServerConfigRepository  - HistoryRepository          |      |
|  |  - LogsRepository          - TestingProfileRepository   |      |
|  +------------------------+-------------------------------+      |
+---------------------------|-----------------------------------+
                            |
                            v
            +-------------------------------+
            |    Core Package (React-free)  |
            |  - MCP Client lifecycle       |
            |  - Transport creation         |
            |  - Handler functions          |
            |  - Type definitions           |
            +-------------------------------+
```

---

## File Structure

```
client/src/stores/
  index.ts                    # Re-exports all stores
  preferencesStore.ts         # Theme, log level, display prefs
  logsDisplayStore.ts         # Log buffer, filters, controls
  executionFormStore.ts       # Tool/resource/prompt form state
  testingProfilesStore.ts     # Sampling/elicitation profiles
```

---

## Migration Path

### Phase 1: Add Zustand (Non-Breaking)

1. Install Zustand: `npm install zustand`
2. Create `client/src/stores/` directory
3. Implement all four stores
4. No changes to existing components yet

### Phase 2: Migrate Components

1. Replace `mockTestingProfiles` in ExecutionContext with store
2. Update preference-dependent components (theme, log settings)
3. Update logs page to use logsDisplay store
4. Update tools/resources/prompts pages to use execution form store

### Phase 3: Connect Repository Layer

1. When storage implementation is decided, create repository implementations
2. Wrap repositories with Zustand store factory pattern
3. No UI component changes required

---

## Open Questions

1. **TanStack Query complement?** Should we add TanStack Query for History/Logs API calls when repositories use proxy API? This would provide caching, background refresh, and optimistic updates.

2. **Devtools in production?** Should Zustand devtools be enabled only in development builds, or also in production for debugging?

3. **Store granularity?** Should execution form store be split into toolsStore, resourcesStore, promptsStore for finer control?

---

## References

- [Issue #983](https://github.com/modelcontextprotocol/inspector/issues/983) - Data spec discussion
- [Discussion #1805](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1805) - Server config storage decision
- [MCPJam Inspector](https://github.com/MCPJam/inspector) - Reference implementation using Zustand
- [Zustand documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)
