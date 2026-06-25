import type { Application, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';

import { env } from '@config/env.config';
import { swaggerSpec } from '@config/swagger.config';

import { auditLogRoutes } from '@modules/audit-log/audit-log.routes';
import { authRoutes } from '@modules/auth/auth.routes';
import { contestRoutes } from '@modules/contest';
import { fantasyRoutes } from '@modules/fantasy';
import { healthRoutes } from '@modules/health/health.routes';
import { leaderboardRoutes } from '@modules/leaderboard';
import { notificationRoutes } from '@modules/notification';
import { realtimeAdminRoutes } from '@modules/realtime-admin/realtime-admin.routes';
import { roleRoutes } from '@modules/role/role.routes';
import { scoringRoutes } from '@modules/scoring';
import { sessionRoutes } from '@modules/session/session.routes';
import { sportsRoutes } from '@modules/sports/sports.routes';
import { userRoutes } from '@modules/user/user.routes';
import { walletRoutes } from '@modules/wallet/wallet.routes';
import { paymentRoutes } from '@modules/payments';
import { withdrawalRoutes } from '@modules/withdrawals/withdrawal.routes';
import { kycRoutes } from '@modules/kyc';
import { financialAdminRoutes } from '@modules/financial-admin/financial-admin.routes';

/**
 * Registers all feature route groups under the API prefix.
 * Each phase appends its routers here — keeps surface area discoverable.
 */
export const registerRoutes = (app: Application): void => {
  // Bare /health for infra probes (k8s liveness etc.) — outside the API prefix.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

  const prefix = env.API_PREFIX;

  // PHASE 1
  app.use(`${prefix}/health`, healthRoutes);

  // PHASE 2 — Auth, RBAC, sessions, audit
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/roles`, roleRoutes);
  app.use(`${prefix}/sessions`, sessionRoutes);
  app.use(`${prefix}/audit-logs`, auditLogRoutes);

  // PHASE 3 — Wallet, Ledger, Transactions
  app.use(`${prefix}/wallets`, walletRoutes);

  // PHASE 9 — Payments, Withdrawals, KYC, Financial Admin
  app.use(`${prefix}/payments`, paymentRoutes);
  app.use(`${prefix}/withdrawals`, withdrawalRoutes);
  app.use(`${prefix}/kyc`, kycRoutes);
  app.use(`${prefix}/admin/financial`, financialAdminRoutes);

  // PHASE 4 — Sports ingestion, matches, teams, players, tournaments
  app.use(`${prefix}/sports`, sportsRoutes);

  // PHASE 5 — Fantasy teams, rules engine, validation, scoring foundation
  app.use(`${prefix}/fantasy`, fantasyRoutes);

  // PHASE 6 — Contests, contest entries, prize distributions, templates
  app.use(`${prefix}/contests`, contestRoutes);

  // PHASE 7 — Scoring engine + leaderboard + ranking + settlement
  app.use(`${prefix}/scoring`, scoringRoutes);
  app.use(`${prefix}/leaderboard`, leaderboardRoutes);

  // PHASE 8 — Notifications + realtime admin monitoring
  app.use(`${prefix}/notifications`, notificationRoutes);
  app.use(`${prefix}/admin/realtime`, realtimeAdminRoutes);

  if (env.ENABLE_SWAGGER) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }
};
