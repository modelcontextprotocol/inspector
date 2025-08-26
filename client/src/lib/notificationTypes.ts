import {
  NotificationSchema as BaseNotificationSchema,
  ClientNotificationSchema,
  ServerNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const NotificationSchema = ClientNotificationSchema.or(
  ServerNotificationSchema,
).or(BaseNotificationSchema);

export type Notification = z.infer<typeof NotificationSchema>;
