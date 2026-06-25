import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@common/constants';

import { getAgent } from '../helpers/api.client';
import {
  authHeader,
  loginViaApi,
  logoutViaApi,
  refreshViaApi,
  signupViaApi,
  TEST_PASSWORD,
} from '../helpers/auth.helper';
import { expectFailure, expectSuccess } from '../helpers/response.helper';
import { INVALID_PASSWORDS } from '../fixtures/constants.fixture';
import { uniqueEmail } from '../generators/mock-data.generator';

describe('Auth integration', () => {
  const agent = getAgent();

  describe('POST /api/v1/auth/signup', () => {
    it('creates a user and returns access + refresh tokens', async () => {
      const email = uniqueEmail('signup');
      const res = await agent.post('/api/v1/auth/signup').send({
        email,
        password: TEST_PASSWORD,
        displayName: 'Signup Test User',
      });

      const { data } = expectSuccess<{
        user: { id: string; email: string };
        accessToken: string;
        refreshToken: string;
        sessionId: string;
      }>(res, 201);

      expect(data.user.email).toBe(email);
      expect(data.accessToken).toMatch(/^eyJ/);
      expect(data.refreshToken.length).toBeGreaterThan(20);
      expect(data.sessionId).toBeTruthy();
    });

    it('rejects signup when password complexity rules fail', async () => {
      const res = await agent.post('/api/v1/auth/signup').send({
        email: uniqueEmail('weak'),
        password: INVALID_PASSWORDS.tooShort,
      });

      expectFailure(res, 422);
    });

    it('rejects signup when neither email nor phone is provided', async () => {
      const res = await agent.post('/api/v1/auth/signup').send({
        password: TEST_PASSWORD,
      });

      expectFailure(res, 422);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates a registered user', async () => {
      const user = await signupViaApi(agent);
      const tokens = await loginViaApi(agent, user.email, user.password);

      expect(tokens.accessToken).toMatch(/^eyJ/);
      expect(tokens.refreshToken.length).toBeGreaterThan(20);
    });

    it('rejects invalid credentials', async () => {
      const user = await signupViaApi(agent);
      const res = await agent.post('/api/v1/auth/login').send({
        identifier: user.email,
        password: 'WrongPass1!',
      });

      expectFailure(res, 401, ErrorCode.INVALID_CREDENTIALS);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates tokens with a valid refresh token', async () => {
      const user = await signupViaApi(agent);
      const refreshed = await refreshViaApi(agent, user.tokens.refreshToken);

      expect(refreshed.accessToken).toMatch(/^eyJ/);
      expect(refreshed.refreshToken).not.toBe(user.tokens.refreshToken);
    });

    it('rejects an invalid refresh token', async () => {
      const res = await agent.post('/api/v1/auth/refresh').send({
        refreshToken: 'invalid-refresh-token-value',
      });

      expectFailure(res, 401, ErrorCode.REFRESH_TOKEN_INVALID);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the session and blocks subsequent authenticated calls', async () => {
      const user = await signupViaApi(agent);
      await logoutViaApi(agent, user.tokens.accessToken);

      const res = await agent.get('/api/v1/wallets/me').set(authHeader(user.tokens.accessToken));
      expectFailure(res, 401);
    });
  });
});
