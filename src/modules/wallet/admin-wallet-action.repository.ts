import type { ClientSession, FilterQuery, HydratedDocument, Types } from 'mongoose';

import { AdminWalletActionType } from '@common/enums';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { BaseRepository } from '@shared/repositories/base.repository';

import {
  AdminWalletAction,
  type IAdminWalletAction,
} from './admin-wallet-action.model';

class AdminWalletActionRepository extends BaseRepository<IAdminWalletAction> {
  constructor() {
    super(AdminWalletAction);
  }

  createEntry(
    entry: Partial<IAdminWalletAction>,
    session?: ClientSession,
  ): Promise<HydratedDocument<IAdminWalletAction>> {
    return this.create(entry, session);
  }

  listForUser(
    targetUserId: string | Types.ObjectId,
    pagination: PaginationParams,
  ): Promise<Paginated<HydratedDocument<IAdminWalletAction>>> {
    return this.paginate({ targetUserId }, pagination, { defaultSortBy: 'createdAt' });
  }

  list(
    filters: { actionType?: AdminWalletActionType; adminId?: string; targetUserId?: string },
    pagination: PaginationParams,
  ): Promise<Paginated<HydratedDocument<IAdminWalletAction>>> {
    const filter: FilterQuery<IAdminWalletAction> = {};
    if (filters.actionType) filter.actionType = filters.actionType;
    if (filters.adminId) filter.adminId = filters.adminId as unknown as Types.ObjectId;
    if (filters.targetUserId) filter.targetUserId = filters.targetUserId as unknown as Types.ObjectId;
    return this.paginate(filter, pagination, { defaultSortBy: 'createdAt' });
  }
}

export const adminWalletActionRepository = new AdminWalletActionRepository();
export { AdminWalletActionRepository };
