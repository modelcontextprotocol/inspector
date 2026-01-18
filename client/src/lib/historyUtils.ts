import type { HistoryEntry } from '@modelcontextprotocol/inspector-core';

/**
 * Get root entries (entries without a parentRequestId)
 */
export function getRootEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((entry) => !entry.parentRequestId);
}

/**
 * Get child entries for a given parent ID
 */
export function getChildEntries(
  entries: HistoryEntry[],
  parentId: string
): HistoryEntry[] {
  return entries
    .filter((entry) => entry.parentRequestId === parentId)
    .sort((a, b) => (a.relativeTime ?? 0) - (b.relativeTime ?? 0));
}

/**
 * Build a map of parent ID to child entries for efficient lookup
 */
export function buildChildrenMap(
  entries: HistoryEntry[]
): Map<string, HistoryEntry[]> {
  const map = new Map<string, HistoryEntry[]>();

  for (const entry of entries) {
    if (entry.parentRequestId) {
      const children = map.get(entry.parentRequestId) ?? [];
      children.push(entry);
      map.set(entry.parentRequestId, children);
    }
  }

  // Sort children by relative time
  for (const [parentId, children] of map) {
    children.sort((a, b) => (a.relativeTime ?? 0) - (b.relativeTime ?? 0));
    map.set(parentId, children);
  }

  return map;
}

/**
 * Format relative time offset for display
 */
export function formatRelativeTime(ms: number): string {
  if (ms < 1000) {
    return `+${ms}ms`;
  }
  return `+${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get a summary for a child request based on its type
 */
export function getChildSummary(entry: HistoryEntry): string {
  if (entry.method === 'sampling/createMessage') {
    // Extract model from response or params
    const response = entry.response as Record<string, unknown> | undefined;
    const params = entry.params as Record<string, unknown> | undefined;
    const modelPrefs = params?.modelPreferences as Record<string, unknown> | undefined;
    const hints = modelPrefs?.hints as Array<Record<string, unknown>> | undefined;
    const model = response?.model || hints?.[0]?.name || 'unknown model';
    return `Model: ${model}`;
  }

  if (entry.method === 'elicitation/create') {
    const mode = (entry.params as Record<string, unknown>)?.mode || 'form';
    const message = (entry.params as Record<string, unknown>)?.message;
    if (message && typeof message === 'string') {
      return `(${mode}) ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`;
    }
    return `(${mode})`;
  }

  return entry.target || entry.method;
}

/**
 * Get response preview for a child request
 */
export function getResponsePreview(entry: HistoryEntry): string | null {
  if (!entry.response) return null;

  if (entry.method === 'sampling/createMessage') {
    const content = (entry.response as Record<string, unknown>)?.content;
    if (typeof content === 'object' && content !== null) {
      const text = (content as Record<string, unknown>)?.text;
      if (typeof text === 'string') {
        return text.slice(0, 60) + (text.length > 60 ? '...' : '');
      }
    }
    if (typeof content === 'string') {
      return content.slice(0, 60) + (content.length > 60 ? '...' : '');
    }
  }

  if (entry.method === 'elicitation/create') {
    return `User provided: ${JSON.stringify(entry.response).slice(0, 50)}...`;
  }

  return null;
}
