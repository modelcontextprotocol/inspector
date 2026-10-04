/**
 * The Inspector's adapter for the MCP Tasks extension.
 *
 * The protocol itself — both generations' schemas, the poll loop, task RPC,
 * input rounds, the receiver side — is owned by `@modelcontextprotocol/ext-tasks`
 * (#2316). What lives here is only what that package deliberately leaves to
 * its host, plus the conversions between its shapes and the Inspector's:
 *
 * - `rawWireChannel` — the `rawDispatch` the package requires for 2026-07-28
 *   traffic the SDK codec rejects.
 * - `progress` — progress routing for task-backed calls, which the package
 *   does not handle.
 * - `errors`, `wire`, `session` — error identity, JSON/task-view conversions,
 *   and the session's endpoint id and negotiation check.
 * - `notificationSchemas` — `notifications/tasks/list_changed`, which neither
 *   the SDK nor the package defines.
 *
 * Nothing in this folder imports `InspectorClient`; host state reaches it
 * through narrow interfaces. Keep it that way, so whatever the package later
 * absorbs can be deleted here without touching the client, and so other
 * extensions (Skills) can follow the same `core/extension/<name>/` shape.
 */
export * from "./constants.js";
export * from "./errors.js";
export * from "./notificationSchemas.js";
export * from "./progress.js";
export * from "./rawWireChannel.js";
export * from "./session.js";
export * from "./wire.js";
