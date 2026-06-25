import { z } from 'zod';

import { AuditAction, AuditOutcome } from '@common/enums';

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  action: z.nativeEnum(AuditAction).optional(),
  outcome: z.nativeEnum(AuditOutcome).optional(),
  actorId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  onBehalfOfId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
