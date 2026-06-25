import { UserRole } from '@common/enums';

import { BaseService } from '@shared/services/base.service';

import { roleRepository } from './role.repository';
import type { IRole } from './role.model';

/**
 * Role registry service.
 *
 * Phase 2 ships the system roles (USER, ADMIN, SUPER_ADMIN, SUPPORT_AGENT)
 * via `seedSystemRoles()` so the admin UI has rows to render from the
 * very first deploy. Custom roles can be added later by SUPER_ADMINs.
 */

const SYSTEM_ROLES: Pick<IRole, 'key' | 'name' | 'description' | 'permissions'>[] = [
  {
    key: UserRole.USER,
    name: 'User',
    description: 'Default end-user role.',
    permissions: ['user:read:self', 'user:update:self'],
  },
  {
    key: UserRole.SUPPORT_AGENT,
    name: 'Support Agent',
    description: 'Read-only access to user accounts + audit trail.',
    permissions: ['user:read', 'audit:read'],
  },
  {
    key: UserRole.ADMIN,
    name: 'Admin',
    description: 'Manages users, contests, wallet adjustments.',
    permissions: [
      'user:read',
      'user:update',
      'user:suspend',
      'audit:read',
      'role:assign',
    ],
  },
  {
    key: UserRole.SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Full platform control, manages other admins.',
    permissions: ['*'],
  },
];

class RoleService extends BaseService {
  constructor() {
    super('role-service');
  }

  async seedSystemRoles(): Promise<void> {
    for (const role of SYSTEM_ROLES) {
      await roleRepository.upsert(
        { key: role.key },
        {
          $set: {
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            isSystem: true,
          },
        },
      );
    }
    this.logger.info({ count: SYSTEM_ROLES.length }, 'role.seed.completed');
  }

  list(): Promise<IRole[]> {
    return roleRepository.find({}, { sort: { isSystem: -1, key: 1 } }) as unknown as Promise<IRole[]>;
  }
}

export const roleService = new RoleService();
export { RoleService, SYSTEM_ROLES };
