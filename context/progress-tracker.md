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

- **Status:** Done
- **What was built:** `PostsModule` (`POST /posts`, `GET /posts/:id`) as a
  self-contained business module importing `PrismaModule` directly, no
  cross-module service calls. Added the `Post` model to `schema.prisma`
  (uuid PK, `authorId` FK → `User`, `content`, `createdAt`) plus the
  `posts Post[]` relation field on `User`, exactly per spec. `CreatePostDto`
  validates `authorId` as a required UUID and `content` as a required
  non-empty string capped at 500 chars. `PostsService.createPost` looks up
  the author via `PrismaService.user.findUnique` first and throws
  `NotFoundException` on a miss (mirroring spec 02's
  `FollowsService.createFollow` pattern for `followerId`/`followingId`)
  before inserting the post; `findById` follows the same
  find-or-`NotFoundException` pattern as `UsersService.findById`. No Kafka
  publishing — persistence only, per this spec's explicit scope boundary
  with spec 04. Unit tests added (`posts.service.spec.ts`, mocking
  `PrismaService`, 4 tests) covering both the not-found and happy paths for
  `createPost` and `findById`. Verified against the live stack: user
  creation → valid post creation (201), non-existent-but-well-formed
  `authorId` (404), malformed `authorId`/missing `content` (400 validation
  errors), `GET /posts/:id` happy path (200) and 404 all exercised manually
  via curl against a running instance; full `nest build` and `vitest run`
  (20 tests across all specs) also pass clean.
- **Deviations from spec:** None from the spec's own scope. One
  implementation-detail naming fix: `PostsController` imports both the Nest
  `@Post()` decorator and the Prisma `Post` model type, which collide by
  name — the decorator import is aliased to `HttpPost` (matching the
  pattern already used for the Prisma `Post` type elsewhere), a mechanical
  fix with no scope impact.
- **Notes:** Found and flagged a migration/DB drift before writing any spec
  code: the dev Postgres database already had a `Post` table and a
  `_prisma_migrations` row (`20260916191442_add_posts`, applied
  2026-09-16 19:14:42) matching this spec's exact schema, but the
  corresponding `migration.sql` file was missing from
  `prisma/migrations/` on disk (only an empty, untracked directory of that
  name remained) and `schema.prisma` on disk had no `Post` model —
  apparent leftover from an earlier, incomplete session that ran
  `prisma migrate dev` but never got the migration file saved. `prisma
  migrate dev` refused to proceed and offered only `prisma migrate reset`,
  which would have dropped the dev DB's existing data (7 Users, 2 Follows
  at the time). Flagged to the human per `ai-workflow-rules.md` rather than
  resolving unilaterally; approved path was to hand-write a
  `migration.sql` matching the schema already applied (verified via
  `\d "Post"` in the container) under the existing migration name — no
  `prisma migrate reset`, no data loss, `prisma migrate status` confirmed
  in sync afterward.

### 04 - kafka-producer

- **Status:** Done
- **What was built:** `KafkaService` (`src/kafka/kafka.service.ts`) producer
  updated per spec: `idempotent: true` on producer creation, and every
  `publish()` sends with `acks: -1` (KafkaJS's numeric equivalent of the
  spec's `acks: 'all'` — kafkajs's `send()` type takes a number, not the
  string `'all'`; -1 requests ack from every in-sync replica and is also
  required by kafkajs whenever `idempotent: true` is set). Connection
  lifecycle (`onModuleInit`/`onModuleDestroy`) was already in place from
  spec 01 and already fails loudly on bootstrap connect errors (no
  try/catch), matching this spec's requirement unchanged.
  `PostsService.createPost` (spec 03) now publishes a `post.created` event
  to `KafkaService.publish()` after the Postgres write succeeds, with the
  exact contract from architecture-context.md (`postId`, `authorId`,
  `createdAt` as an ISO string via `post.createdAt.toISOString()`). The
  publish call is wrapped in try/catch inside `PostsService` (not
  `KafkaService`) per the spec's error-handling section: failures are
  logged via `Logger` with the `postId` and the error, then swallowed —
  never thrown to the controller, never rolling back the already-committed
  post. `PostsModule` now imports `KafkaModule`. `KafkaService.publish` was
  made generic (`publish<T extends Record<string, unknown>>`) purely to
  satisfy strict-mode structural typing for the event payload type — no
  behavior change. Unit tests added to `posts.service.spec.ts` (mocking
  `KafkaService`): publish is not called when author lookup 404s, the
  event payload matches the contract, and `createPost` still resolves with
  the post when `kafka.publish` rejects — 22 tests passing across all spec
  files, `nest build` and `tsc --noEmit` both clean.
  Verified against the live stack end-to-end: `POST /posts` produces a
  `post.created` message on the topic matching the contract exactly
  (confirmed via `kafka-console-consumer`); killing the Kafka container and
  calling `POST /posts` still returned 201 (post persisted in Postgres) and
  logged a clear `[PostsService] Failed to publish post.created event for
  post <id>` error line; restarting Kafka and creating a new post
  afterward published successfully again immediately, with no producer
  crash or stuck state from the earlier failure.
- **Deviations from spec:** None from the spec's own scope.
- **Notes:** Flagged (not silently resolved) during verification: with
  Kafka killed, `POST /posts` still returned 201 as required, but took
  ~17s to do so — KafkaJS's default producer retry policy (5 retries,
  exponential backoff) runs *inside* the single `producer.send()` call
  before it finally rejects, and `PostsService` awaits that call before
  responding. This isn't `PostsService` adding its own retry loop (the
  spec's "not retried synchronously inside the request" line, read
  literally, is about not wrapping `kafka.publish()` in manual retry logic,
  which this implementation doesn't do), but it does mean a real request
  can block for several seconds when Kafka is down, which is in tension
  with the architecture's stated goal of not coupling post-creation latency
  to Kafka's health. This spec's "Producer configuration" section only
  locks `idempotent: true`, `acks: 'all'`, and single-partition — it says
  nothing about retry count or request timeout, so tuning those down
  (e.g. `retry: { retries: 0 }` or a short `requestTimeout`) would be
  adding a config decision outside this spec's explicit scope. Left as
  KafkaJS defaults pending a decision from the human on whether to
  fast-fail instead; acceptance criteria as written are met either way.

### 05 - kafka-consumer-fanout

- **Status:** Done
- **What was built:** `KafkaService` gained a generic `subscribe<T>(groupId, topic, onMessage)`
  helper (connects a consumer, subscribes, JSON-parses each message, forwards
  it to the caller's handler, tracks the consumer so `onModuleDestroy`
  disconnects it) — pure wiring, no knowledge of `post.created` or fan-out.
  `FeedModule` now owns `FanoutConsumer` (`src/feed/fanout-consumer.ts`,
  named per the exact filename example in `code-standards.md`), which on
  `onModuleInit` calls `kafka.subscribe('feed-fanout-consumer', 'post.created', ...)`
  and, per message, calls `FollowsService.getFollowerIds(authorId)` then
  `RedisService.zAdd('feed:{followerId}', score, postId)` for every follower
  — unconditionally, no celebrity check. `FollowsService` is now exported
  from `FollowsModule` (previously private to it) so `FeedModule` can inject
  it; `FeedModule` also now imports `KafkaModule` and `RedisModule`. Errors
  from `getFollowerIds` are caught/logged with `postId` and abort just that
  message's fan-out (no throw, no crash); each follower's `zAdd` failure is
  caught/logged individually so one bad write doesn't abort the rest.
  Completion is logged as `Fanned out post {postId} to {n}/{total} followers`.
  Unit tests added (`fanout-consumer.spec.ts`, 6 tests, mocking `KafkaService`/
  `FollowsService`/`RedisService`): subscribe wiring, multi-follower fan-out,
  zero-follower no-op, follower-lookup failure swallowed, one-bad-write
  doesn't block the rest, and reprocessing the same message sends the same
  idempotent write twice rather than a duplicate-producing one — 28 tests
  passing across all spec files, `tsc --noEmit` and `nest build` both clean.
  Verified against the live stack: `POST /posts` from an author with two
  followers resulted in the post ID appearing in both `feed:{followerId}`
  sorted sets (`redis-cli ZRANGE ... WITHSCORES`) with a numeric score; a
  post from a followerless author produced zero new Redis keys, not a
  crash; manually re-publishing the identical `post.created` message via
  `kafka-console-producer` left `ZCARD feed:{followerId}` unchanged at 1 —
  all three acceptance criteria confirmed directly against Redis state.
- **Deviations from spec:** None from the spec's own scope. One ambiguity
  resolved and flagged rather than picked silently: the spec's fan-out step
  reads `RedisService.zAdd('feed:{followerId}', createdAt, postId)`, but
  `RedisService.zAdd`'s existing signature (locked in spec 01) takes a
  numeric `score`, and the event's `createdAt` (per the spec 04/
  architecture-context.md contract) is an ISO string, not a number. Used
  `new Date(createdAt).getTime()` (epoch ms) as the score, matching
  architecture-context.md's Redis key structure note ("score = post
  timestamp") literally rather than passing the string through. No other
  interpretation makes the existing `zAdd` type-check.
- **Notes:** During live verification, a leftover `npm run start` invocation
  (started to test in a clean process) collided on port 3000 with an
  already-running `nest start --watch` instance from earlier in the session,
  briefly joining a second consumer into the `feed-fanout-consumer` group
  before crashing on the port conflict — this triggered a consumer-group
  rebalance that swallowed the first round of test messages (empty Redis
  result, not a code defect). Confirmed by retesting against only the
  pre-existing instance, which fanned out correctly; no code change was
  needed. The stray process was not started deliberately and exited on its
  own (crash, not killed).

  **Post-review fix:** the human tested resilience to Redis being down
  mid-fanout and found connection-level failures surfacing as raw
  `[ioredis] Unhandled error event` console warnings instead of going
  through `RedisService`'s own logging, because the ioredis client had no
  `.on('error', ...)` listener attached — a gap against code-standards.md's
  "no silent/unhandled errors" intent and spec 05's error-handling section.
  Fixed by attaching `this.client.on('error', (error) =>
  this.logger.error('Redis client error', error))` in `RedisService`'s
  constructor, alongside client creation. Minor mismatch per
  ai-workflow-rules.md (missing log line via the wrong channel) — patched
  in place, not regenerated. Re-verified live: stopping Redis now produces
  repeating `[RedisService] Redis client error` lines through Nest's
  `Logger` on each reconnect attempt, with no unhandled-event warning.

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
