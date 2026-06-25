import { randomUUID } from 'node:crypto';

import { AppConstants } from '@common/constants';

import type { ApiAgent } from './api.client';
import { expectSuccess } from './response.helper';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface AuthenticatedUser {
  email: string;
  password: string;
  userId: string;
  tokens: AuthTokens;
}

export const TEST_PASSWORD = 'TestPass1!';

export const authHeader = (accessToken: string): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
});

export const idempotencyHeader = (key?: string): Record<string, string> => ({
  [AppConstants.IDEMPOTENCY_KEY_HEADER]: key ?? randomUUID(),
});

export interface SignupInput {
  email?: string;
  phone?: string;
  password?: string;
  displayName?: string;
  username?: string;
}

/** Register a user via the public signup API. */
export const signupViaApi = async (
  agent: ApiAgent,
  input: SignupInput = {},
): Promise<AuthenticatedUser> => {
  const email = input.email ?? `user-${randomUUID().slice(0, 8)}@win11.test`;
  const password = input.password ?? TEST_PASSWORD;

  const res = await agent.post('/api/v1/auth/signup').send({
    email: input.phone ? undefined : email,
    phone: input.phone,
    password,
    displayName: input.displayName ?? 'Integration User',
    username: input.username,
  });

  const { data } = expectSuccess<{
    user: { id: string };
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  }>(res, 201);

  return {
    email,
    password,
    userId: data.user.id,
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      sessionId: data.sessionId,
    },
  };
};

/** Login with identifier + password. */
export const loginViaApi = async (
  agent: ApiAgent,
  identifier: string,
  password: string,
): Promise<AuthTokens> => {
  const res = await agent.post('/api/v1/auth/login').send({ identifier, password });
  const { data } = expectSuccess<{
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  }>(res, 200);

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    sessionId: data.sessionId,
  };
};

export const refreshViaApi = async (
  agent: ApiAgent,
  refreshToken: string,
): Promise<AuthTokens> => {
  const res = await agent.post('/api/v1/auth/refresh').send({ refreshToken });
  const { data } = expectSuccess<{
    accessToken: string;
    refreshToken: string;
  }>(res, 200);

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    sessionId: '',
  };
};

export const logoutViaApi = async (
  agent: ApiAgent,
  accessToken: string,
  allDevices = false,
): Promise<void> => {
  const res = await agent
    .post('/api/v1/auth/logout')
    .set(authHeader(accessToken))
    .send({ allDevices });

  expectSuccess(res, 200);
};
