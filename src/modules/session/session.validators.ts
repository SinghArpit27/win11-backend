import { z } from 'zod';

import { objectIdString } from '@common/validators';

const objectId = objectIdString('id');

export const sessionIdParamsSchema = z.object({ sessionId: objectId });
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

export const userIdParamsSchema = z.object({ userId: objectId });
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
