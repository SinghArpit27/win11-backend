import { afterAll, afterEach, beforeAll } from 'vitest';

import { connectTestDatabase, disconnectTestDatabase, rollbackTestDatabase } from '../helpers/db.helper';

beforeAll(async () => {
  await connectTestDatabase();
});

afterEach(async () => {
  await rollbackTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});
