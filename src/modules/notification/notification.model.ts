import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { NotificationType } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

export interface INotification extends BaseDocFields {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: Date | null;
  sourceEvent: string | null;
}

export type NotificationDoc = HydratedDocument<INotification>;
export type NotificationModel = Model<INotification>;

const notificationSchema = createBaseSchema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(NotificationType), required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    data: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    sourceEvent: { type: String, default: null, maxlength: 64 },
  },
  { collection: 'notifications' },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
