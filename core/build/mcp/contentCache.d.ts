import type { ResourceReadInvocation, ResourceTemplateReadInvocation, PromptGetInvocation, ToolCallInvocation } from "./types.js";
/**
 * Read-only interface for accessing cached content.
 * This interface is exposed to users of InspectorClient.
 */
export interface ReadOnlyContentCache {
    /**
     * Get cached resource content by URI
     * @param uri - The URI of the resource
     * @returns The cached invocation object or null if not cached
     */
    getResource(uri: string): ResourceReadInvocation | null;
    /**
     * Get cached resource template content by URI template
     * @param uriTemplate - The URI template string (unique identifier)
     * @returns The cached invocation object or null if not cached
     */
    getResourceTemplate(uriTemplate: string): ResourceTemplateReadInvocation | null;
    /**
     * Get cached prompt content by name
     * @param name - The prompt name
     * @returns The cached invocation object or null if not cached
     */
    getPrompt(name: string): PromptGetInvocation | null;
    /**
     * Get cached tool call result by tool name
     * @param toolName - The tool name
     * @returns The cached invocation object or null if not cached
     */
    getToolCallResult(toolName: string): ToolCallInvocation | null;
    /**
     * Clear cached content for a specific resource
     * @param uri - The URI of the resource to clear
     */
    clearResource(uri: string): void;
    /**
     * Clear all cached content for a given URI.
     * This clears both regular resources cached by URI and resource templates
     * that have a matching expandedUri.
     * @param uri - The URI to clear from all caches
     */
    clearResourceAndResourceTemplate(uri: string): void;
    /**
     * Clear cached content for a specific resource template
     * @param uriTemplate - The URI template string to clear
     */
    clearResourceTemplate(uriTemplate: string): void;
    /**
     * Clear cached content for a specific prompt
     * @param name - The prompt name to clear
     */
    clearPrompt(name: string): void;
    /**
     * Clear cached tool call result for a specific tool
     * @param toolName - The tool name to clear
     */
    clearToolCallResult(toolName: string): void;
    /**
     * Clear all cached content
     */
    clearAll(): void;
}
/**
 * Read-write interface for accessing and modifying cached content.
 * This interface is used internally by InspectorClient.
 */
export interface ReadWriteContentCache extends ReadOnlyContentCache {
    /**
     * Store resource content in cache
     * @param uri - The URI of the resource
     * @param invocation - The invocation object to cache
     */
    setResource(uri: string, invocation: ResourceReadInvocation): void;
    /**
     * Store resource template content in cache
     * @param uriTemplate - The URI template string (unique identifier)
     * @param invocation - The invocation object to cache
     */
    setResourceTemplate(uriTemplate: string, invocation: ResourceTemplateReadInvocation): void;
    /**
     * Store prompt content in cache
     * @param name - The prompt name
     * @param invocation - The invocation object to cache
     */
    setPrompt(name: string, invocation: PromptGetInvocation): void;
    /**
     * Store tool call result in cache
     * @param toolName - The tool name
     * @param invocation - The invocation object to cache
     */
    setToolCallResult(toolName: string, invocation: ToolCallInvocation): void;
}
/**
 * ContentCache manages cached content for resources, resource templates, prompts, and tool calls.
 * This class implements ReadWriteContentCache and can be exposed as ReadOnlyContentCache to users.
 */
export declare class ContentCache implements ReadWriteContentCache {
    private resourceContentCache;
    private resourceTemplateContentCache;
    private promptContentCache;
    private toolCallResultCache;
    getResource(uri: string): ResourceReadInvocation | null;
    getResourceTemplate(uriTemplate: string): ResourceTemplateReadInvocation | null;
    getPrompt(name: string): PromptGetInvocation | null;
    getToolCallResult(toolName: string): ToolCallInvocation | null;
    clearResource(uri: string): void;
    /**
     * Clear all cached content for a given URI.
     * This clears both regular resources cached by URI and resource templates
     * that have a matching expandedUri.
     * @param uri - The URI to clear from all caches
     */
    clearResourceAndResourceTemplate(uri: string): void;
    clearResourceTemplate(uriTemplate: string): void;
    clearPrompt(name: string): void;
    clearToolCallResult(toolName: string): void;
    clearAll(): void;
    setResource(uri: string, invocation: ResourceReadInvocation): void;
    setResourceTemplate(uriTemplate: string, invocation: ResourceTemplateReadInvocation): void;
    setPrompt(name: string, invocation: PromptGetInvocation): void;
    setToolCallResult(toolName: string, invocation: ToolCallInvocation): void;
}
//# sourceMappingURL=contentCache.d.ts.map