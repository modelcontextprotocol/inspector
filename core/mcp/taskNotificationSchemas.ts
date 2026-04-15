/**
 * Notification schema for notifications/tasks/list_changed (server → client).
 *
 * The SDK exports list_changed schemas for resources, prompts, tools, and roots, and
 * TaskStatusNotificationSchema for notifications/tasks/status, but no schema for
 * notifications/tasks/list_changed. Mainline (v1) does not register a schema for it
 * either: they use client.fallbackNotificationHandler so any unmatched notification
 * (including tasks/list_changed) is passed to onNotification, and App branches on
 * notification.method === "notifications/tasks/list_changed". We register specific
 * handlers only (no fallback), so we define this schema to handle the notification.
 *
 * List-changed notifications have no defined params (they are signals to refetch);
 * the SDK uses params: NotificationsParamsSchema.optional() for other list_changed
 * types (which is private, so we can't import it). We accept optional params only
 * so the notification parses; we do not use any params in the handler.
 */
import { NotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

export const TasksListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal("notifications/tasks/list_changed"),
  params: z.record(z.string(), z.unknown()).optional(),
});
