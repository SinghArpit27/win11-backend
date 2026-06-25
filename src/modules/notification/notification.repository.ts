import type { FilterQuery, Types } from 'mongoose';

import { NotificationType } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import { Notification, type INotification, type NotificationDoc } from './notification.model';

class NotificationRepository extends BaseRepository<INotification> {
  constructor() {
    super(Notification);
  }

  listForUser(
    userId: string,
    filters: { isRead?: boolean; type?: NotificationType },
    pagination: PaginationParams,
  ): Promise<Paginated<NotificationDoc>> {
    const filter: FilterQuery<INotification> = {
      userId: userId as unknown as Types.ObjectId,
      isDeleted: false,
    };
    if (filters.isRead !== undefined) filter.isRead = filters.isRead;
    if (filters.type) filter.type = filters.type;

    return this.paginate(filter, pagination, { sort: { createdAt: -1 } });
  }

  countUnread(userId: string): Promise<number> {
    return this.count({ userId, isRead: false, isDeleted: false });
  }

  markRead(userId: string, notificationId: string): Promise<NotificationDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: notificationId, userId, isDeleted: false },
        { isRead: true, readAt: new Date() },
        { new: true },
      )
      .exec();
  }

  markAllRead(userId: string): Promise<number> {
    return this.model
      .updateMany(
        { userId, isRead: false, isDeleted: false },
        { isRead: true, readAt: new Date() },
      )
      .exec()
      .then((res) => res.modifiedCount ?? 0);
  }
}

export const notificationRepository = new NotificationRepository();
