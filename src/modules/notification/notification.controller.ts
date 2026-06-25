import type { Request, Response } from 'express';

import { ErrorCode, HttpStatus } from '@common/constants';
import { AppError } from '@common/errors';
import { asyncHandler, sendSuccess } from '@common/utils';
import { parsePagination } from '@common/utils/pagination.util';

import { notificationService } from './notification.service';
import { notificationSerializer } from './notification.serializers';
import type { NotificationListQuery, NotificationParams } from './notification.validators';

const requireUser = (req: Request) => {
  if (!req.user) {
    throw new AppError('Unauthorized', HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED);
  }
  return req.user;
};

export const listMyNotificationsController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const query = req.query as unknown as NotificationListQuery;
  const pagination = parsePagination(query);

  const result = await notificationService.listForUser(
    user.id,
    { isRead: query.isRead, type: query.type },
    pagination,
  );

  return sendSuccess(
    res,
    result.items.map((doc) => notificationSerializer.toDTO(doc)),
    { meta: result.meta },
  );
});

export const getUnreadCountController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const count = await notificationService.unreadCount(user.id);
  return sendSuccess(res, { unreadCount: count });
});

export const markNotificationReadController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { notificationId } = req.params as unknown as NotificationParams;
  const doc = await notificationService.markRead(user.id, notificationId);
  if (!doc) {
    throw new AppError('Notification not found', HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  }
  return sendSuccess(res, notificationSerializer.toDTO(doc));
});

export const markAllNotificationsReadController = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const updated = await notificationService.markAllRead(user.id);
  return sendSuccess(res, { updated });
});
