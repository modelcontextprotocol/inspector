/**
 * ContentCache manages cached content for resources, resource templates, prompts, and tool calls.
 * This class implements ReadWriteContentCache and can be exposed as ReadOnlyContentCache to users.
 */
export class ContentCache {
    // Internal storage - all cached content managed by this single object
    resourceContentCache = new Map(); // Keyed by URI
    resourceTemplateContentCache = new Map(); // Keyed by uriTemplate
    promptContentCache = new Map();
    toolCallResultCache = new Map();
    // Read-only getter methods
    getResource(uri) {
        return this.resourceContentCache.get(uri) ?? null;
    }
    getResourceTemplate(uriTemplate) {
        return this.resourceTemplateContentCache.get(uriTemplate) ?? null;
    }
    getPrompt(name) {
        return this.promptContentCache.get(name) ?? null;
    }
    getToolCallResult(toolName) {
        return this.toolCallResultCache.get(toolName) ?? null;
    }
    // Clear methods
    clearResource(uri) {
        this.resourceContentCache.delete(uri);
    }
    /**
     * Clear all cached content for a given URI.
     * This clears both regular resources cached by URI and resource templates
     * that have a matching expandedUri.
     * @param uri - The URI to clear from all caches
     */
    clearResourceAndResourceTemplate(uri) {
        // Clear regular resource cache
        this.resourceContentCache.delete(uri);
        // Clear any resource templates with matching expandedUri
        for (const [uriTemplate, invocation,] of this.resourceTemplateContentCache.entries()) {
            if (invocation.expandedUri === uri) {
                this.resourceTemplateContentCache.delete(uriTemplate);
            }
        }
    }
    clearResourceTemplate(uriTemplate) {
        this.resourceTemplateContentCache.delete(uriTemplate);
    }
    clearPrompt(name) {
        this.promptContentCache.delete(name);
    }
    clearToolCallResult(toolName) {
        this.toolCallResultCache.delete(toolName);
    }
    clearAll() {
        this.resourceContentCache.clear();
        this.resourceTemplateContentCache.clear();
        this.promptContentCache.clear();
        this.toolCallResultCache.clear();
    }
    // Write methods (for internal use by InspectorClient)
    setResource(uri, invocation) {
        this.resourceContentCache.set(uri, invocation);
    }
    setResourceTemplate(uriTemplate, invocation) {
        this.resourceTemplateContentCache.set(uriTemplate, invocation);
    }
    setPrompt(name, invocation) {
        this.promptContentCache.set(name, invocation);
    }
    setToolCallResult(toolName, invocation) {
        this.toolCallResultCache.set(toolName, invocation);
    }
}
//# sourceMappingURL=contentCache.js.map