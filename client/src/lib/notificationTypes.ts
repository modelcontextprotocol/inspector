import {
  NotificationSchema as BaseNotificationSchema,
  ClientNotificationSchema,
  ServerNotificationSchema,
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
)
  .or(ServerNotificationSchema)
  .or(BaseNotificationSchema);

export type StdErrNotification = z.infer<typeof StdErrNotificationSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
