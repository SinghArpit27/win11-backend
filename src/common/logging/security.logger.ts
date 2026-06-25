import type { Request } from 'express';

import { logger as rootLogger } from '@config/logger.config';

import { AuditAction } from '@common/enums';

import { auditLogger } from './audit.logger';

/**
 * Security / suspicious-activity logger.
 *
 * Dedicated channel that:
 *  - emits a `warn` log on the `security` Pino channel (separate from
 *    normal request logs so SIEM rules can filter cleanly),
 *  - persists an audit row with `SUSPICIOUS_ACTIVITY` action,
 *  - never throws — degrades to a console warning if the audit write fails.
 *
 * Call sites: brute-force lockouts, refresh-token reuse, role-mismatch
 * on admin routes, rate-limit hits crossing a threshold.
 */
const securityChannel = rootLogger.child({ channel: 'security' });

export interface SuspiciousEvent {
  reason: string;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export const securityLogger = {
  suspicious(event: SuspiciousEvent): Promise<void> {
    securityChannel.warn(
      {
        reason: event.reason,
        actorId: event.actorId ?? null,
        ip: event.ip ?? event.req?.ip ?? null,
        userAgent: event.userAgent ?? event.req?.header('user-agent') ?? null,
        requestId: event.req?.id ?? null,
        metadata: event.metadata,
      },
      'security.suspicious',
    );

    return auditLogger.record({
      action: AuditAction.SUSPICIOUS_ACTIVITY,
      actorId: event.actorId ?? null,
      metadata: { reason: event.reason, ...(event.metadata ?? {}) },
      req: event.req,
    });
  },

  rateLimitHit(event: Omit<SuspiciousEvent, 'reason'>): Promise<void> {
    securityChannel.warn(
      {
        actorId: event.actorId ?? null,
        ip: event.ip ?? event.req?.ip ?? null,
        requestId: event.req?.id ?? null,
        metadata: event.metadata,
      },
      'security.rate_limit_hit',
    );

    return auditLogger.record({
      action: AuditAction.RATE_LIMIT_HIT,
      actorId: event.actorId ?? null,
      metadata: event.metadata ?? {},
      req: event.req,
    });
  },
};
