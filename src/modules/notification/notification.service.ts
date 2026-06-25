import { logger } from '@config/logger.config';
import { isRedisEnabled } from '@config/redis.config';

import { NotificationType, QueueName } from '@common/enums';

import { realtimePublisher } from '@events/realtime.publisher';
import { getQueue, registerWorker } from '@queues/queue.factory';

import { notificationRepository } from './notification.repository';
import { Notification, type NotificationDoc } from './notification.model';
import type { CreateNotificationInput } from './notification.types';

export interface NotificationJobPayload extends CreateNotificationInput {
  persist?: boolean;
}

class NotificationService {
  async create(input: CreateNotificationInput): Promise<NotificationDoc> {
    const doc = await Notification.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      sourceEvent: input.sourceEvent ?? null,
      isRead: false,
      readAt: null,
    });

    await realtimePublisher.notificationNew({
      notificationId: String(doc._id),
      userId: String(input.userId),
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    });

    return doc;
  }

  async enqueue(input: CreateNotificationInput): Promise<void> {
    if (!isRedisEnabled()) {
      await this.create(input);
      return;
    }
    await getQueue<NotificationJobPayload>(QueueName.NOTIFICATION).add('deliver', {
      ...input,
      persist: true,
    });
  }

  listForUser(
    userId: string,
    filters: { isRead?: boolean; type?: CreateNotificationInput['type'] },
    pagination: { page: number; limit: number },
  ) {
    return notificationRepository.listForUser(userId, filters, pagination);
  }

  unreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  }

  markRead(userId: string, notificationId: string) {
    return notificationRepository.markRead(userId, notificationId);
  }

  markAllRead(userId: string) {
    return notificationRepository.markAllRead(userId);
  }
}

export const notificationService = new NotificationService();

export const initNotificationJobs = (): void => {
  if (!isRedisEnabled()) return;

  registerWorker<NotificationJobPayload>(
    QueueName.NOTIFICATION,
    async (job) => {
      await notificationService.create(job.data);
    },
    { concurrency: 10 },
  );

  logger.info({ event: 'notification.jobs.ready' }, 'Notification worker registered');
};

export const notificationTypeForWallet = (): NotificationType => NotificationType.WALLET;
