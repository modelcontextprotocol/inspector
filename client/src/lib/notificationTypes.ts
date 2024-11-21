import {
  NotificationSchema as BaseNotificationSchema,
  ClientNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const StdErrNotificationSchema = BaseNotificationSchema.extend({
  method: z.literal("notifications/stderr"),
  params: z.object({
    content: z.string(),
  }),
});

export const NotificationSchema = ClientNotificationSchema.or(
  StdErrNotificationSchema,
);

export type StdErrNotification = z.infer<typeof StdErrNotificationSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
