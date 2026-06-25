import type { Request, Response } from 'express';

import { asyncHandler, sendSuccess } from '@common/utils';

import { auditLogService } from './audit-log.service';
import type { ListAuditLogsQuery } from './audit-log.validators';

export const adminListAuditLogsController = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditLogService.list(req.query as unknown as ListAuditLogsQuery);
  return sendSuccess(res, result.items, { meta: result.meta });
});
