import { BaseRepository } from '@shared/repositories/base.repository';

import { Role, type IRole } from './role.model';

class RoleRepository extends BaseRepository<IRole> {
  constructor() {
    super(Role);
  }
}

export const roleRepository = new RoleRepository();
export { RoleRepository };
