import bcrypt from 'bcryptjs';

import { AppConstants } from '@common/constants';

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, AppConstants.PASSWORD.BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
