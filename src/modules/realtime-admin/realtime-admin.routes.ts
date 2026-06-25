import { Router } from 'express';

import { UserRole } from '@common/enums';
import { requireAuth, requireRoles } from '@common/middlewares';
import { asyncHandler, sendSuccess } from '@common/utils';

import { deadLetterService } from '@events/dead-letter.service';
import { realtimeMetrics } from '@events/realtime-metrics.service';
import {
  getDeadLetterCount,
  getNotificationQueueMetrics,
  getRealtimeQueueDepth,
} from '@jobs/realtime.jobs';
import { getSocketServer } from '@sockets/socket.server';

const router = Router();
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

export const getAdminRealtimeMetricsController = asyncHandler(async (_req, res) => {
  const io = getSocketServer();
  const [queueDepth, notificationQueue, deadLetters] = await Promise.all([
    getRealtimeQueueDepth(),
    getNotificationQueueMetrics(),
    getDeadLetterCount(),
  ]);

  return sendSuccess(res, {
    sockets: {
      connections: io.engine.clientsCount,
      namespaces: 6,
    },
    metrics: realtimeMetrics.snapshot(),
    queues: {
      realtimeDispatch: queueDepth,
      notification: notificationQueue,
    },
    deadLetters,
  });
});

export const listDeadLettersController = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const items = await deadLetterService.list(limit);
  return sendSuccess(res, items);
});

router.get(
  '/metrics',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  getAdminRealtimeMetricsController,
);

router.get(
  '/dead-letters',
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  listDeadLettersController,
);

export { router as realtimeAdminRoutes };
