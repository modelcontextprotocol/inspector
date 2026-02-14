/**
 * Returns the transport type for an MCP server configuration.
 * If type is omitted, defaults to "stdio". Throws if type is invalid.
 */
export function getServerType(config) {
    if (!("type" in config) || config.type === undefined) {
        return "stdio";
    }
    const type = config.type;
    if (type === "stdio") {
        return "stdio";
    }
    if (type === "sse") {
        return "sse";
    }
    if (type === "streamable-http") {
        return "streamable-http";
    }
    throw new Error(`Invalid server type: ${type}. Valid types are: stdio, sse, streamable-http`);
}
//# sourceMappingURL=config.js.map