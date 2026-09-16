# Progress Tracker — Feed Fan-Out Backend System

This file is updated after each feature spec is implemented and reviewed —
not before, and not mid-implementation. It's the single source of truth for
what's actually done vs. what's planned.

## How to log an entry

Each completed feature spec gets one entry:

### [NN] - feature-name

- **Status:** Done
- **What was built:** one or two lines, plain description
- **Deviations from spec:** any deviation that was flagged and approved
  during implementation (per ai-workflow-rules.md), or "None"
- **Notes:** anything worth remembering later (e.g. a tradeoff made, a
  follow-up item spun off into future scope)

## Status legend

- **Not started** — spec not yet written or not yet picked up
- **Spec drafted** — spec written, not yet locked
- **Spec locked** — spec locked, implementation not yet started
- **In progress** — implementation underway
- **Done** — implemented and reviewed against its spec
- **Blocked** — waiting on a decision or a dependency

## MVP progress

### 01 - setup

- **Status:** Done
- **What was built:** NestJS project scaffold; docker-compose.yml running
  Postgres, Kafka (KRaft, single broker), Redis, and Elasticsearch; all 10
  module skeletons (users, follows, posts, feed, search, common, prisma,
  kafka, redis, elasticsearch) registered in app.module.ts; @nestjs/config
  wired globally with .env.example; kafka/redis/elasticsearch infra modules
  each connect on startup and log a health-check line (kafkajs producer
  connect, ioredis `.connect()`, `client.ping()` respectively); Prisma set
  up against the local Postgres container (schema.prisma + prisma.config.ts,
  `@prisma/adapter-pg` driver adapter, PrismaService wrapping PrismaClient
  with connect/disconnect lifecycle), verified via `prisma validate`,
  `prisma generate`, and `prisma db push`, informed by the installed
  `prisma-cli`/`prisma-database-setup`/`prisma-client-api` skills. Verified
  end-to-end: full docker-compose stack + `npm run start` booted cleanly
  with all 5 connections (Postgres/Kafka/Redis/Elasticsearch + app) logging
  success, then torn down.
- **Deviations from spec:** Pinned `prisma`/`@prisma/client` to `7.10.0`
  explicitly rather than installing `latest` — `prisma@latest` currently
  resolves to an `8.0.0` release candidate while `@prisma/client@latest` is
  still `7.10.0`; installing unpinned would have mismatched majors.
  Generated Prisma Client output path set to `src/generated/prisma` (not
  the skill's default `../generated`, which lands outside `src/`) so it's
  inside `tsconfig.build.json`'s `rootDir`/`include` scope and actually gets
  compiled. Both flagged and applied without further approval needed as
  straightforward implementation-detail fixes, not scope changes.
- **Notes:** Prisma integration went through Prisma's official skills
  package instead of the originally-planned MCP server (already reflected
  in this spec's own revision history) — Prisma's current MCP server is
  remote-only and scoped to Prisma Postgres, not applicable to our
  self-hosted container. During implementation the agent mistakenly ran
  `cp .env.example .env` once (a write to `.env`, forbidden under
  ai-workflow-rules.md even though spec wording seemed to call for it) —
  caught and flagged immediately, not repeated; all subsequent verification
  used inline shell env vars instead of touching `.env`.

### 02 - users-follows

- **Status:** Done — reviewed and closed
- **What was built:** `UsersModule` (`POST /users`, `GET /users/:id`) and
  `FollowsModule` (`POST /follows`, `GET /users/:id/followers` — implemented
  in `FollowsController` per spec) as separate NestJS modules, each importing
  `PrismaModule` directly with no cross-module service calls. Added `User`
  and `Follow` models to `schema.prisma` (composite PK on
  `(followerId, followingId)`) and ran the first real
  `prisma migrate dev` migration (`add_users_and_follows`) after resetting
  the local Postgres volume per the spec's pre-implementation note.
  `FollowsService.createFollow` validates self-follow and non-existent
  users up front, then inserts the `Follow` row and increments
  `followingId`'s `followerCount` in one `$transaction`, catching a
  Prisma `P2002` unique-constraint violation and translating it to
  `BadRequestException` for duplicates. `getFollowerIds`/`getFollowingIds`
  added for later specs (05, 09). Unit tests added for both services
  (`users.service.spec.ts`, `follows.service.spec.ts`) mocking
  `PrismaService`. Verified against the live stack: full user/follow flow,
  duplicate/self-follow/non-existent-user 4xx cases, and validation-error
  4xx all exercised manually via curl against a running instance.
  On review, `getFollowerIds`/`getFollowingIds` test coverage was found to
  only exercise the multi-result case; added empty-array cases for both
  methods plus a shared-follow-graph case (A follows B and C; verifies B
  and C each resolve to 1 follower/0 following, and A resolves to
  0 followers/2 following) to `follows.service.spec.ts` — now 16 tests
  passing across both spec files.
- **Deviations from spec:** None from the spec's own scope. One dependency
  addition flagged and approved before implementing: `class-validator` +
  `class-transformer` were not yet in `package.json`; installed them and
  added a global `ValidationPipe` (`whitelist: true, transform: true`) in
  `main.ts`, since `code-standards.md` already mandates DTO validation via
  `class-validator` and this is the first spec with DTOs. During review, a
  `GET /users` (`findAll`) endpoint was found on disk in
  `users.controller.ts`/`users.service.ts` that was never part of this
  spec's locked scope (spec 02 only lists `POST /users` and
  `GET /users/:id`) — flagged and removed per explicit instruction; a
  "list all users" endpoint, if ever needed, will come from its own spec
  decision.
- **Notes:** Two assumptions made where the spec was silent, both
  consistent with its own stated patterns rather than picked arbitrarily:
  (1) `GET /users/:id/followers` returns `{ followerCount, followerIds }`
  — spec said "count and/or list" and acceptance criteria requires data
  usable for verifying fan-out targets (spec 05), so both are included.
  (2) Duplicate *username* on `POST /users` returns `BadRequestException`
  (catching Prisma's `P2002`), mirroring the exact pattern the spec
  specifies for duplicate follows, even though the spec's "Error handling"
  section only calls this out explicitly for follows. `GET /users/:id` and
  `GET /users/:id/followers` both 404 via `NotFoundException` on a missing
  user, standard REST behavior not spelled out in the spec's error-handling
  section but consistent with it. Added after the original 8-item scope was
  found to be missing a user/follow-graph module, which posts and fan-out
  both depend on. Caused specs 03–08 to renumber to 03–09.

### 03 - posts-module

- **Status:** Spec locked

### 04 - kafka-producer

- **Status:** Not started

### 05 - kafka-consumer-fanout

- **Status:** Not started

### 06 - feed-read-endpoint

- **Status:** Not started

### 07 - elasticsearch-search

- **Status:** Not started

### 08 - rate-limiter

- **Status:** Not started

### 09 - celebrity-threshold-and-resilience

- **Status:** Not started

## Deferred decisions log

Tracks decisions explicitly deferred from a context file to a later feature
spec, so nothing gets forgotten:

- Celebrity follower-count threshold + read-time merge mechanism → spec `09`
