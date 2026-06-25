/**
 * Must run before any `@config/*` import.
 * Loads `.env.test` overrides on top of the local `.env` baseline.
 */
import path from 'node:path';

import dotenv from 'dotenv';

const root = process.cwd();

dotenv.config({ path: path.resolve(root, '.env') });
dotenv.config({ path: path.resolve(root, '.env.test'), override: true });

process.env.NODE_ENV = 'test';
