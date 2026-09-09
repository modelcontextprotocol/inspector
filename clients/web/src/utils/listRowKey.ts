/**
 * A stable per-row React key for a list whose natural identifier is not
 * guaranteed unique.
 *
 * MCP list results carry no uniqueness constraint: a server may return the same
 * tool name (#1957), the same resource `uri`, or the same `uriTemplate` more
 * than once, and a locally-maintained list (roots) can collect a duplicate the
 * same way. Keying a row on that identifier alone collides, which React warns
 * about on every render and which lets a filtered-out row survive
 * reconciliation — the duplicate is rendered once, or dropped, rather than
 * shown as the two entries the server actually sent (#2206).
 *
 * The item's position in the **unfiltered** list disambiguates duplicates and
 * stays stable while a search narrows the view, so capture it before filtering.
 *
 * This is a UI identity only. The wire identity is still the identifier itself
 * — a `tools/call` sends the name, a `resources/read` sends the URI — so a key
 * must never be sent to a server.
 */
export function listRowKey(id: string, sourceIndex: number): string {
  return `${sourceIndex}:${id}`;
}
