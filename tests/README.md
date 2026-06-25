# Win11 Backend Integration Tests

Production-grade HTTP integration tests for the Win11 backend using **Vitest**, **Supertest**, and an isolated **MongoDB** database.

## Prerequisites

1. **MongoDB** running locally as a single-node replica set (`rs0`) — required for wallet and contest join transactions.
2. Copy `.env.test` values if your Mongo host differs from `mongodb://localhost:27017/win11_test?replicaSet=rs0&directConnection=true`.
3. **Redis disabled** in tests (`REDIS_ENABLED=false`) — leaderboards use the Mongo fallback path.

## Running tests

```bash
cd backend
npm run test:integration
```

Watch mode:

```bash
npm run test:integration:watch
```

## Layout

```
tests/
├── setup/           # Env bootstrap, DB connect, per-test rollback
├── helpers/         # API client, auth, DB, seed, response assertions
├── factories/       # Re-export barrel for test builders
├── fixtures/        # Static payloads (cricket squad, constants)
├── generators/      # Unique emails, phones, idempotency keys
└── integration/     # Test suites by domain
```

## Isolation strategy

Each test runs against the `win11_test` database. After every test, **all collections are cleared** (`rollbackTestDatabase`) to emulate transaction rollback between tests. Individual API calls still execute real MongoDB multi-document transactions inside the service layer.

## Covered flows

| Suite | Coverage |
|-------|----------|
| `auth.integration.test.ts` | Signup, login, refresh, logout |
| `wallet.integration.test.ts` | Deposit, history, insufficient balance |
| `fantasy.integration.test.ts` | Create team, validation failures, update |
| `contest.integration.test.ts` | Listing, details, join, duplicate prevention |
| `leaderboard.integration.test.ts` | Entry registration, retrieval, ranking |
| `e2e-journey.integration.test.ts` | Full user journey end-to-end |

## Seed data

`seedTestWorld()` creates a minimal cricket environment:

- Tournament, home/away teams, upcoming T20 match
- 22 players with `player_stats` rows
- Active fantasy + scoring rules (T20)
- Practice (free) and paid contests

Use `signupViaApi()` + `seedTestWorld()` in tests that need authenticated users and match context.

## See also

- [Integration Testing Guide](../../docs/testing/INTEGRATION-TESTING.md)
