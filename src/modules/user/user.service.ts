import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';

import { AuditAction, UserRole, UserStatus } from '@common/enums';
import { ConflictError, ForbiddenError, NotFoundError } from '@common/errors';
import { auditLogger } from '@common/logging';

import { BaseService } from '@shared/services/base.service';
import type { Paginated, PaginationParams } from '@common/types/common.types';

import { sessionRepository } from '@modules/session/session.repository';

import { toPublicUser, type PublicUser } from '@modules/auth/auth.service';
import { userRepository } from './user.repository';
import type {
  AdminUpdateUserBody,
  ListUsersQuery,
  UpdateMeBody,
} from './user.validators';
import type { IUser } from './user.model';

class UserService extends BaseService {
  constructor() {
    super('user-service');
  }

  async getById(userId: string): Promise<PublicUser> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(user);
  }

  async updateMe(userId: string, input: UpdateMeBody): Promise<PublicUser> {
    if (input.username) {
      const taken = await userRepository.findOne({
        username: input.username,
        _id: { $ne: userId },
      });
      if (taken) throw new ConflictError('Username already taken', { field: 'username' });
    }
    const updated = await userRepository.updateById(userId, { $set: input });
    if (!updated) throw new NotFoundError('User');
    return toPublicUser(updated);
  }

  async listForAdmin(query: ListUsersQuery): Promise<Paginated<PublicUser>> {
    const filter: FilterQuery<IUser> = {};
    if (query.status) filter.status = query.status;
    if (query.role) filter.roles = query.role;
    if (query.q) {
      const re = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: re }, { phone: re }, { username: re }, { displayName: re }];
    }

    const params: PaginationParams = {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    const result = await userRepository.paginate(filter, params, {
      defaultSortBy: 'createdAt',
    });
    return {
      items: result.items.map(toPublicUser),
      meta: result.meta,
    };
  }

  async adminUpdateUser(
    actorId: string,
    actorRoles: UserRole[],
    targetUserId: string,
    input: AdminUpdateUserBody,
    req: Request,
  ): Promise<PublicUser> {
    const target = await userRepository.findById(targetUserId);
    if (!target) throw new NotFoundError('User');

    // SUPER_ADMIN protection: only SUPER_ADMIN can edit a SUPER_ADMIN.
    if (
      target.roles.includes(UserRole.SUPER_ADMIN) &&
      !actorRoles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenError('Cannot modify SUPER_ADMIN user');
    }
    // Only SUPER_ADMIN can grant SUPER_ADMIN.
    if (
      input.roles?.includes(UserRole.SUPER_ADMIN) &&
      !actorRoles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenError('Cannot grant SUPER_ADMIN role');
    }

    const updated = await userRepository.updateById(targetUserId, { $set: input });
    if (!updated) throw new NotFoundError('User');

    if (input.status === UserStatus.SUSPENDED) {
      await sessionRepository.revokeAllForUser(targetUserId, 'admin_suspended');
      await auditLogger.success({
        actorId,
        actorRoles,
        onBehalfOfId: targetUserId,
        action: AuditAction.ADMIN_USER_SUSPENDED,
        resource: 'user',
        resourceId: targetUserId,
        req,
      });
    } else if (input.status === UserStatus.ACTIVE) {
      await auditLogger.success({
        actorId,
        actorRoles,
        onBehalfOfId: targetUserId,
        action: AuditAction.ADMIN_USER_REACTIVATED,
        resource: 'user',
        resourceId: targetUserId,
        req,
      });
    }
    if (input.roles) {
      await auditLogger.success({
        actorId,
        actorRoles,
        onBehalfOfId: targetUserId,
        action: AuditAction.ADMIN_ROLE_ASSIGNED,
        resource: 'user',
        resourceId: targetUserId,
        metadata: { roles: input.roles },
        req,
      });
    }

    await auditLogger.success({
      actorId,
      actorRoles,
      onBehalfOfId: targetUserId,
      action: AuditAction.ADMIN_USER_UPDATED,
      resource: 'user',
      resourceId: targetUserId,
      metadata: { changes: input },
      req,
    });

    return toPublicUser(updated);
  }
}

export const userService = new UserService();
export { UserService };
