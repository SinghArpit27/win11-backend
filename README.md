# Win11 Backend

Production-grade fantasy sports backend — **modular monolith** built on
Node.js + Express + TypeScript with MongoDB, Redis, BullMQ and Socket.io.

> **Status: PHASE 1 — boilerplate.** Health endpoint, security middleware,
> error handler, generic repository, queue + socket scaffolding. Feature
> modules land phase-by-phase.

---

## Tech stack

| Layer        | Library                                                  |
| ------------ | -------------------------------------------------------- |
| Runtime      | Node 20, TypeScript 5                                    |
| HTTP         | Express 4 + Helmet + CORS + rate-limit + hpp + xss-clean |
| Persistence  | MongoDB (Mongoose 8)                                     |
| Cache / RL   | Redis 7 (ioredis)                                        |
| Queues       | BullMQ                                                   |
| Realtime     | Socket.io                                                |
| Validation   | Zod                                                      |
| Auth         | JWT (HS256) — full module ships in PHASE 2               |
| Logging      | Pino (+ pino-pretty in dev)                              |
| Docs         | swagger-jsdoc + swagger-ui-express                       |
| Testing      | Jest + ts-jest                                           |
| Container    | Multi-stage Dockerfile + docker-compose                  |

## Folder structure

```
backend/
├── src/
│   ├── app.ts                      # Builds Express app (side-effect-free)
│   ├── server.ts                   # Bootstraps loaders + listens on PORT
│   │
│   ├── config/                     # Validated env, db, redis, logger, swagger
│   ├── common/
│   │   ├── constants/              # HTTP status, error codes, app constants
│   │   ├── enums/                  # Domain enums (single source of truth)
│   │   ├── errors/                 # AppError + typed subclasses
│   │   ├── middlewares/            # request-id, auth, validate, rate-limit, error-handler
│   │   ├── types/                  # Cross-cutting TypeScript types
│   │   └── utils/                  # api-response, async-handler, jwt, pagination, cache, transaction
│   │
│   ├── shared/
│   │   ├── repositories/base.repository.ts   # Generic CRUD + pagination
│   │   ├── services/base.service.ts          # Scoped logger base class
│   │   └── dtos/pagination.dto.ts            # Reusable Zod pagination schema
│   │
│   ├── loaders/                    # Bootstraps: express, database, redis, sockets, queues, routes
│   ├── modules/                    # Feature modules (modular monolith)
│   │   ├── health/                 # ✅ PHASE 1
│   │   └── auth/                   # ⏳ PHASE 2 (placeholder)
│   │
│   ├── sockets/                    # Socket.io server + typed emitters
│   ├── queues/                     # BullMQ factory + standalone worker entry
│   └── jobs/                       # Cron scheduler (reserved)
│
├── Dockerfile                      # Multi-stage build
├── docker-compose.yml              # api + worker + mongo + redis
├── .env.example                    # Validated by `config/env.config.ts`
├── tsconfig.json                   # Path aliases: @config @common @shared @modules ...
├── .eslintrc.json + .prettierrc.json
└── README.md
```

## Architecture principles

- **Modular monolith → microservice-ready.** Each feature is a self-contained
  folder (`controller / service / repository / model / validators / routes`)
  with zero cross-feature imports. Extracting a service later becomes a
  rename + container.
- **Clean architecture layering.** Controllers stay thin (HTTP only).
  Business rules live in services. Persistence is hidden behind repositories
  that extend `BaseRepository<T>`.
- **SOLID.** Single-responsibility files, open/closed extension via base
  classes, dependency inversion through the repository abstraction.
- **Single error contract.** All errors flow through `AppError` and the
  global `errorHandler` middleware, producing the canonical
  `{ success, error: { code, message, details }, requestId, timestamp }`
  envelope.
- **Single response contract.** Controllers must use `sendSuccess` /
  `sendCreated` / `sendNoContent` — never `res.json` directly.
- **Validated config.** `process.env` is touched in exactly one place
  (`config/env.config.ts`); startup fails fast on invalid input.

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#  → fill JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (≥ 32 chars each)

# 3. Run dependencies + API + worker
docker compose up --build
# Health  → http://localhost:4000/health
# Swagger → http://localhost:4000/docs

# Local-only run (with Mongo + Redis on your machine)
npm run dev
```

## Useful scripts

| Script                | Description                                  |
| --------------------- | -------------------------------------------- |
| `npm run dev`         | Nodemon + ts-node, hot-reload                |
| `npm run build`       | Compile TypeScript → `dist/`                 |
| `npm start`           | Run compiled API                             |
| `npm run start:worker`| Run compiled BullMQ worker                   |
| `npm run lint`        | ESLint (zero warnings tolerated)             |
| `npm run lint:fix`    | Auto-fix lint                                |
| `npm run format`      | Prettier write                               |
| `npm run typecheck`   | `tsc --noEmit`                               |
| `npm test`            | Jest                                         |

## What ships next

- **PHASE 2** — Authentication module, user module, session management,
  OTP, device management.
- **PHASE 3** — Wallet system (ledger, transactions, withdrawals).
- See `docs/requirements/PHASE-01-requirements.md` and onwards for the full
  roadmap.
