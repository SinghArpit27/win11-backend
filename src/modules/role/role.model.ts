import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { UserRole } from '@common/enums';

import { createBaseSchema, type BaseDocFields } from '@shared/models/base.schema';

/**
 * Role registry.
 *
 * PHASE 2 stores roles as static enum values on the User document for
 * fast guard checks (no extra lookup on every request). This collection
 * exists in parallel to:
 *  - describe each role + the permissions attached to it (used by the
 *    admin UI to render role-management screens),
 *  - allow custom non-system roles to be added by SUPER_ADMINs without
 *    code changes,
 *  - record audit metadata (who created / last modified the role).
 *
 * `isSystem` roles cannot be deleted from the admin panel — they back
 * the enum, so removing them would break code paths.
 */
export interface IRole extends BaseDocFields {
  _id: Types.ObjectId;

  key: UserRole | string;
  name: string;
  description: string | null;
  permissions: string[];

  isSystem: boolean;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
}

export type RoleDoc = HydratedDocument<IRole>;
export type RoleModel = Model<IRole>;

const roleSchema = createBaseSchema<IRole>(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    permissions: { type: [String], default: [] },

    isSystem: { type: Boolean, default: false, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'roles' },
);

export const Role: RoleModel = model<IRole>('Role', roleSchema);
