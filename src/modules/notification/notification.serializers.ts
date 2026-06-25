import type { HydratedDocument } from 'mongoose';

import type { INotification } from './notification.model';
import type { NotificationDTO } from './notification.types';

export const notificationSerializer = {
  toDTO(doc: HydratedDocument<INotification>): NotificationDTO {
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      data: doc.data ?? {},
      isRead: doc.isRead,
      readAt: doc.readAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  },
};
