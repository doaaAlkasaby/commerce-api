import { z } from 'zod';

export const notificationIdParamSchema =
  z.object({
    notificationId: z.uuid(),
  });

export const notificationListQuerySchema =
  z.object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20),
  });

export type NotificationListQuery =
  z.infer<typeof notificationListQuerySchema>;