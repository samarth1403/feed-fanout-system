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

- **Status:** Spec locked
- **Notes:** Added after the original 8-item scope was found to be missing
  a user/follow-graph module, which posts and fan-out both depend on.
  Caused specs 03–08 to renumber to 03–09.

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
