import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { AuditAction, AuditOutcome } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Centralised audit trail. Every privileged or security-sensitive action
 * lands here so we have a tamper-evident timeline for compliance / forensics.
 *
 * Examples:
 *  - User signup / login (success + failure)
 *  - Refresh token reuse detection (security)
 *  - Admin overrides on user records
 *  - Suspicious activity (rate-limit hits, ban evasion, etc.)
 *
 * The collection grows unbounded by design — rotation / archival is owned
 * by a later phase (Phase 10 — monitoring + compliance).
 */
export interface IAuditLog extends BaseDocFields {
  _id: Types.ObjectId;

  actorId: Types.ObjectId | null;
  actorRoles: string[];
  onBehalfOfId: Types.ObjectId | null;

  action: AuditAction;
  outcome: AuditOutcome;
  resource: string | null;
  resourceId: string | null;

  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;

  metadata: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
}

export type AuditLogDoc = HydratedDocument<IAuditLog>;
export type AuditLogModel = Model<IAuditLog>;

const auditLogSchema = createBaseSchema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRoles: { type: [String], default: [] },
    onBehalfOfId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    action: {
      type: String,
      enum: Object.values(AuditAction),
      required: true,
      index: true,
    },
    outcome: {
      type: String,
      enum: Object.values(AuditOutcome),
      required: true,
      index: true,
    },
    resource: { type: String, default: null },
    resourceId: { type: String, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null, index: true },
    correlationId: { type: String, default: null },

    metadata: { type: Schema.Types.Mixed, default: {} },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  { collection: 'audit_logs' },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ onBehalfOfId: 1, createdAt: -1 });

export const AuditLog: AuditLogModel = model<IAuditLog>('AuditLog', auditLogSchema);
