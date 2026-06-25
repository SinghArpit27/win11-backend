import type { Request } from 'express';

import { logger as rootLogger } from '@config/logger.config';

import { AppConstants } from '@common/constants';
import { AuditAction, AuditOutcome } from '@common/enums';

import { AuditLog, type IAuditLog } from '@modules/audit-log/audit-log.model';

/**
 * Audit logger.
 *
 * Persists a row in `audit_logs` AND emits a structured Pino log line so
 * log aggregators (Datadog/Loki/Elastic) see the same event without
 * needing to tail Mongo. Failures inside the audit pipeline NEVER throw
 * — they degrade to a warn log so business flows are not blocked by an
 * observability hiccup.
 *
 * Audit row + log line carry the request-id so they can be joined against
 * the http.request log line on the same trace.
 */

export interface AuditContext {
  actorId?: string | null;
  actorRoles?: string[];
  onBehalfOfId?: string | null;
  action: AuditAction;
  outcome?: AuditOutcome;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  req?: Request;
}

const auditChannel = rootLogger.child({ channel: 'audit' });

const extractRequestContext = (req?: Request): Partial<IAuditLog> => {
  if (!req) return {};
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    requestId: req.id ?? null,
    correlationId: req.correlationId ?? null,
  };
};

export const auditLogger = {
  async record(ctx: AuditContext): Promise<void> {
    const outcome = ctx.outcome ?? AuditOutcome.SUCCESS;
    const reqCtx = extractRequestContext(ctx.req);
    const row = {
      actorId: ctx.actorId ?? null,
      actorRoles: ctx.actorRoles ?? [],
      onBehalfOfId: ctx.onBehalfOfId ?? null,
      action: ctx.action,
      outcome,
      resource: ctx.resource ?? null,
      resourceId: ctx.resourceId ?? null,
      metadata: ctx.metadata ?? {},
      errorCode: ctx.errorCode ?? null,
      errorMessage: ctx.errorMessage ?? null,
      ...reqCtx,
    } as Partial<IAuditLog>;

    try {
      await AuditLog.create(row);
    } catch (err) {
      auditChannel.warn({ err, action: ctx.action }, 'audit.persist_failed');
    }

    auditChannel.info(
      {
        action: ctx.action,
        outcome,
        actorId: ctx.actorId,
        resource: ctx.resource,
        resourceId: ctx.resourceId,
        requestId: reqCtx.requestId,
        metadata: ctx.metadata,
      },
      `audit.${ctx.action}`,
    );
  },

  /** Convenience for success path — keeps call sites terse. */
  success(ctx: Omit<AuditContext, 'outcome'>): Promise<void> {
    return this.record({ ...ctx, outcome: AuditOutcome.SUCCESS });
  },

  failure(
    ctx: Omit<AuditContext, 'outcome'> & { errorCode?: string; errorMessage?: string },
  ): Promise<void> {
    return this.record({ ...ctx, outcome: AuditOutcome.FAILURE });
  },

  // Re-export common identifiers so call sites can avoid an extra import.
  Action: AuditAction,
  Outcome: AuditOutcome,
} as const;

// Re-export for guard middlewares
export { AppConstants };
