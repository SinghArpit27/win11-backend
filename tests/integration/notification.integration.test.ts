import { describe, expect, it } from 'vitest';

import { NotificationType } from '@common/enums';

import { notificationService } from '@modules/notification/notification.service';

import { getAgent } from '../helpers/api.client';
import { authHeader, signupViaApi } from '../helpers/auth.helper';
import { expectSuccess } from '../helpers/response.helper';

describe('Notification integration', () => {
  const agent = getAgent();

  it('lists notifications with pagination and unread count', async () => {
    const user = await signupViaApi(agent);

    await notificationService.create({
      userId: user.userId,
      type: NotificationType.CONTEST,
      title: 'Joined contest',
      body: 'You joined a practice contest',
      data: { contestId: 'c1' },
    });

    await notificationService.create({
      userId: user.userId,
      type: NotificationType.WALLET,
      title: 'Deposit received',
      body: '₹100 added to wallet',
      data: {},
    });

    const unreadRes = await agent
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(user.tokens.accessToken));
    const { data: unread } = expectSuccess<{ unreadCount: number }>(unreadRes, 200);
    expect(unread.unreadCount).toBe(2);

    const listRes = await agent
      .get('/api/v1/notifications')
      .query({ page: 1, limit: 10 })
      .set(authHeader(user.tokens.accessToken));
    const { data: items, meta } = expectSuccess<
      Array<{ id: string; title: string; isRead: boolean }>
    >(listRes, 200);

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect((meta as { total?: number })?.total ?? items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((n) => n.isRead === false)).toBe(true);
  });

  it('marks one notification read and decrements unread count', async () => {
    const user = await signupViaApi(agent);

    const doc = await notificationService.create({
      userId: user.userId,
      type: NotificationType.SYSTEM,
      title: 'Welcome',
      body: 'Welcome to Win11',
      data: {},
    });

    const markRes = await agent
      .post(`/api/v1/notifications/${String(doc._id)}/read`)
      .set(authHeader(user.tokens.accessToken));
    const { data: marked } = expectSuccess<{ id: string; isRead: boolean }>(markRes, 200);
    expect(marked.isRead).toBe(true);

    const unreadRes = await agent
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(user.tokens.accessToken));
    const { data: unread } = expectSuccess<{ unreadCount: number }>(unreadRes, 200);
    expect(unread.unreadCount).toBe(0);
  });

  it('marks all notifications read', async () => {
    const user = await signupViaApi(agent);

    await notificationService.create({
      userId: user.userId,
      type: NotificationType.PROMOTION,
      title: 'Offer',
      body: 'Limited time bonus',
      data: {},
    });
    await notificationService.create({
      userId: user.userId,
      type: NotificationType.MATCH,
      title: 'Match live',
      body: 'IND vs AUS is live',
      data: {},
    });

    const markAllRes = await agent
      .post('/api/v1/notifications/read-all')
      .set(authHeader(user.tokens.accessToken));
    const { data: result } = expectSuccess<{ updated: number }>(markAllRes, 200);
    expect(result.updated).toBeGreaterThanOrEqual(2);

    const unreadRes = await agent
      .get('/api/v1/notifications/unread-count')
      .set(authHeader(user.tokens.accessToken));
    const { data: unread } = expectSuccess<{ unreadCount: number }>(unreadRes, 200);
    expect(unread.unreadCount).toBe(0);
  });
});
