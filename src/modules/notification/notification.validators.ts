import { z } from 'zod';

import { NotificationType } from '@common/enums';
import { objectIdString, paginationSchema } from '@common/validators';

export const notificationListQuerySchema = paginationSchema.extend({
  isRead: z.coerce.boolean().optional(),
  type: z.nativeEnum(NotificationType).optional(),
});

export const notificationParamsSchema = z.object({
  notificationId: objectIdString('notificationId'),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationParams = z.infer<typeof notificationParamsSchema>;
