import {
  ClientNotificationSchema,
  NotificationSchema as BaseNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const StderrNotificationSchema = BaseNotificationSchema.extend({
  method: z.literal("notifications/stderr"),
  params: z.object({
    content: z.string(),
  }),
});

export const NotificationSchema = ClientNotificationSchema.or(
  StderrNotificationSchema,
);

export type StdErrNotification = z.infer<typeof StderrNotificationSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
