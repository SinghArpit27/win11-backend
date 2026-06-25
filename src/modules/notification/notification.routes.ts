import { Router } from 'express';

import { requireAuth, validate } from '@common/middlewares';

import {
  getUnreadCountController,
  listMyNotificationsController,
  markAllNotificationsReadController,
  markNotificationReadController,
} from './notification.controller';
import { notificationListQuerySchema, notificationParamsSchema } from './notification.validators';

const router = Router();

router.get('/', requireAuth, validate({ query: notificationListQuerySchema }), listMyNotificationsController);
router.get('/unread-count', requireAuth, getUnreadCountController);
router.post('/read-all', requireAuth, markAllNotificationsReadController);
router.post(
  '/:notificationId/read',
  requireAuth,
  validate({ params: notificationParamsSchema }),
  markNotificationReadController,
);

export { router as notificationRoutes };
