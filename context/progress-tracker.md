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

  **Post-review fix (structural):** the human found `ElasticsearchService`
  had the same cold-start bootstrap-blocking bug already fixed for Redis
  (spec 05) and Kafka (spec 04): `onModuleInit` did `await
  this.client.ping()` before resolving, so Elasticsearch being unreachable
  at startup blocked/crashed Nest's bootstrap, breaking unrelated paths
  like `POST /posts`/`GET /users`. Fixed the same way as Redis/Kafka:
  `onModuleInit` is no longer async and fires a background
  `pingWithRetry()` loop (5s between attempts, mirroring
  `KAFKA_RECONNECT_RETRY_DELAY_MS`) without being awaited, so bootstrap
  never blocks on it; `onModuleDestroy` (newly added — this service had
  none before) sets a `shuttingDown` flag to stop the loop cleanly and
  closes the client. One real difference from Redis/Kafka, noted rather
  than papered over: Elasticsearch's client is stateless HTTP per request,
  not a persistent connection like ioredis/kafkajs — so `index()`/
  `search()` calls need no reconnect logic of their own once the server is
  reachable again; the retry loop exists solely to keep the "still
  down"/"connected" log signal accurate without blocking boot. Added
  `elasticsearch.service.spec.ts` (6 tests, none existed before) covering
  the same shape of cases as the Redis/Kafka specs: no throw/block on
  startup failure, retry-until-connected then stop, success/error logging,
  stop-on-destroy, and index/search delegation — 50 tests passing across
  all spec files, `tsc --noEmit` clean. Verified live end-to-end: with the
  Elasticsearch container stopped, a fresh `npm run start` logged `Nest
  application successfully started` well before Elasticsearch's own
  connection-error logs even began appearing, and `POST /users`, `GET
  /users/:id`, `POST /posts` all worked normally (26ms for the post);
  starting the container afterward (no app restart) produced
  `[ElasticsearchService] Connected to Elasticsearch` with no further
  action needed.
- **Deviations from spec:** None — same reasoning as the Redis/Kafka
  fixes: spec 01's acceptance criteria ("Elasticsearch — `client.ping()`
  succeeds... logs a clear success line on boot") describes the happy-path
  definition of a successful connection, not a requirement that a failed
  one must block bootstrap.

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

  **Post-review fix (error handling, not connection lifecycle):** the
  human asked for the same cold-start resilience treatment already applied
  to Redis/Kafka/Elasticsearch to be *investigated* for Prisma, but
  explicitly not applied the same way, since Postgres is the source of
  truth and a write/read must still fail when it's unreachable — only the
  failure's shape was the actual bug. Investigated `PrismaService.onModuleInit`
  first, per the human's request to confirm what it actually does: it
  calls `await this.$connect()` and logs success immediately after — and
  with `@prisma/adapter-pg`, `$connect()` doesn't verify a real connection
  at all, because the underlying `pg.Pool` connects lazily on its first
  query. Confirmed live: `[PrismaService] Connected to Postgres via Prisma`
  logged even with the Postgres container stopped. This log's honesty
  wasn't fixed (out of scope — the human asked to confirm the behavior and
  fix the *downstream* error shape, not change Prisma's connection
  lifecycle to match Redis/Kafka/ES; flagging that mismatch here rather
  than silently also changing `onModuleInit`). The actual query failure —
  confirmed live — surfaces as a `PrismaClientKnownRequestError` with
  `code: 'ECONNREFUSED'` (the raw pg/Node driver error code, not one of
  Prisma's own P-prefixed codes — a consequence of using `@prisma/adapter-pg`
  rather than Prisma's Rust query engine), which was previously uncaught,
  reaching Nest's default handler as a generic 500 "Internal server error"
  with a stack trace. Fixed by adding `src/prisma/prisma-connection-error.ts`
  (`isPrismaConnectionError`, checking for `PrismaClientInitializationError`
  or a `PrismaClientKnownRequestError` with a network-failure code —
  `ECONNREFUSED`/`ETIMEDOUT`/`ECONNRESET`/`ENOTFOUND`) and
  `src/common/filters/prisma-exception.filter.ts` (`PrismaExceptionFilter`,
  `@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientInitializationError)`,
  extending Nest's `BaseExceptionFilter`), registered application-wide via
  `APP_FILTER` in `CommonModule` (previously empty). A connectivity error
  now gets a deliberate `ServiceUnavailableException` (503, "Database is
  temporarily unavailable"); anything else matching those two Prisma error
  classes (e.g. an unhandled error code this fix doesn't specifically
  target) still falls through to `super.catch()` — Nest's own default
  handling, unchanged — so the blast radius is limited to exactly the
  connectivity case. This is deliberately a shared, cross-cutting fix
  rather than duplicated try/catch in `PostsService`,
  `UsersService`, and `FollowsService` individually: errors those services
  already translate themselves (e.g. `P2002` → `BadRequestException`) are
  caught inside the method before this filter ever sees them, so existing
  behavior there is untouched — verified live that a duplicate username
  still returns 400, not 503. Added `prisma-connection-error.spec.ts` (8
  tests) and `prisma-exception.filter.spec.ts` (3 tests) — 61 tests passing
  across all spec files, `tsc --noEmit` clean. Verified live end-to-end:
  with the Postgres container stopped, a fresh `npm run start` still
  booted cleanly (`[PrismaService] Connected to Postgres via Prisma` still
  logs — the lazy-pool behavior above, unchanged); `POST /users`,
  `POST /posts`, and `GET /users/:id` (an existing user, verified before
  stopping Postgres) each returned a clean
  `{"message":"Database is temporarily unavailable","error":"Service
  Unavailable","statusCode":503}` instead of a stack-trace-shaped 500,
  with `[PrismaExceptionFilter] Postgres is unreachable` logged for each;
  starting Postgres back up resumed all three endpoints immediately with
  no app restart (confirmed via a fresh `POST /users` → 201, `GET
  /users/:id` → 200, `POST /posts` → 201).
- **Deviations from spec:** None — Postgres is still required for every
  path that touches it, exactly as before; only the failure response
  shape changed.

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

  **Post-review fix (structural):** mirroring the RedisService fix logged
  under spec 05, the human found `KafkaService.onModuleInit` had the
  identical bug: `await this.producer.connect()` before resolving meant a
  Kafka-never-up cold start blocked/crashed Nest's bootstrap, breaking
  unrelated paths like `GET /users` that never touch Kafka. Investigating
  the fix surfaced a real difference from the Redis case: ioredis retries a
  failed connection forever in the background by default, but kafkajs's
  own `connect()` retrier is bounded (5 attempts, exponential backoff, then
  a permanent rejection — confirmed by reading
  `node_modules/kafkajs/src/retry/index.js` and
  `node_modules/kafkajs/src/cluster/brokerPool.js`), and a producer that
  has never once connected successfully rejects every `send()` immediately
  with `KafkaJSError('The producer is disconnected')` rather than trying
  the network (`node_modules/kafkajs/src/producer/messageProducer.js`) —
  so a bare fire-and-forget `.catch()` (enough for Redis) would leave the
  producer permanently stuck after its first 5 failed attempts, with no
  path back even once Kafka came up. Fixed by wrapping `producer.connect()`
  in an unbounded loop (`connectProducerWithRetry`, 5s between attempts)
  run from `onModuleInit` without being awaited, so bootstrap never blocks
  on it; success is now logged via the producer's own `CONNECT`
  instrumentation event (fires on every successful connect, first or
  later) rather than the line after the removed `await`. This also
  surfaced a second, related instance of the same bug: `FanoutConsumer`
  (spec 05) awaits `KafkaService.subscribe()`, which itself awaited
  `consumer.connect()` — so a Kafka-down cold start would still block
  bootstrap via the consumer path even after fixing the producer alone.
  Flagging this rather than silently expanding scope: fixed it anyway,
  since it lives in the same file the human named and is required for the
  ticket's own acceptance criteria (`GET /users` working on a Kafka-down
  boot) to actually hold — `subscribe()` now pushes the consumer for
  shutdown tracking immediately and runs its own connect/subscribe/run
  attempt through the same unbounded retry loop
  (`runConsumerWithRetry`), without the caller awaiting completion. A
  `shuttingDown` flag (set in `onModuleDestroy`) stops both retry loops
  from scheduling further attempts after an intentional shutdown, so
  neither loop outlives the app closing (no equivalent hazard exists on
  the ioredis side, since `client.disconnect()` already halts its internal
  retryStrategy on its own). Added `kafka.service.spec.ts` (8 tests, none
  existed before), using fake timers to advance the retry loop
  deterministically: producer connect doesn't block/throw when Kafka is
  down, keeps retrying until connected then stops, logs via the `CONNECT`
  event on first connect and reconnect, and stops retrying after
  `onModuleDestroy`; `subscribe()` resolves without waiting on the
  consumer, wires `connect`/`subscribe`/`run` correctly, forwards parsed
  messages to the handler, and retries until the consumer starts running —
  41 tests passing across all spec files, `tsc --noEmit` clean. Verified
  live end-to-end: with the Kafka container stopped, a fresh `npm run
  start` logged `Nest application successfully started` and `Application
  is running on port 3000` while kafkajs's own connection-error logs
  repeated in the background; `POST /users` (200 on the following `GET
  /users/:id`) and `POST /posts` (200 on the following `GET /posts/:id`)
  both worked normally. Starting the Kafka container afterward (no app
  restart) produced `[KafkaService] Consumer feed-fanout-consumer
  subscribed to post.created` and `[KafkaService] Connected to Kafka`, and
  a subsequent `POST /posts` published successfully with no "Failed to
  publish" error logged.
- **Deviations from spec:** None — same reasoning as the Redis fix under
  spec 05: spec 04's acceptance criteria describes the happy-path
  definition of a successful connection, not a requirement that a failed
  one must block bootstrap.

  **Post-review fix (log noise):** the retry loops above made a real
  Kafka outage very noisy: kafkajs's own default console logger repeats
  `[Connection] Connection error` and `[BrokerPool] Failed to connect to
  seed broker` once per internal sub-attempt of its own bounded connect
  retrier, on top of `KafkaService`'s own one-line-per-outer-attempt
  summary — redundant once that summary exists. The human asked for this
  fixed via kafkajs's log configuration specifically, not by widening the
  retry delay (retry timing was to stay unchanged), and asked to keep
  `KafkaService`'s own retry-attempt/success log lines exactly as they
  are. A blanket `logLevel` cutoff couldn't isolate just these two lines,
  since kafkajs logs other, non-redundant things at the same ERROR level
  (e.g. a running consumer's own crash/restart messages from kafkajs's
  independent built-in crash-restart handling, which is a real signal
  worth keeping) — confirmed by reading
  `node_modules/kafkajs/src/network/connection.js` and
  `.../cluster/brokerPool.js` for the exact logger namespaces
  (`'Connection'`, `'BrokerPool'`) these two messages are logged under.
  Implemented a custom `kafkaLogCreator` (exported from `kafka.service.ts`
  for direct testing) passed as the `Kafka` client's `logCreator` option:
  it drops any log entry whose namespace is `Connection` or `BrokerPool`
  and otherwise reproduces kafkajs's default console format unchanged
  (byte-for-byte JSON shape, `[Namespace] message` prefix, same
  info/warn/error/debug → console method dispatch), so every other
  kafkajs-emitted log (consumer crash/restart, group rebalance info, etc.)
  still prints exactly as before. Added 3 tests to
  `kafka.service.spec.ts` (44 tests total across all spec files now):
  suppresses both named namespaces, passes through another namespace at
  ERROR level with the exact expected JSON shape, and dispatches an INFO
  entry to `console.info`. Verified live end-to-end: with the Kafka
  container stopped, a fresh boot produced zero `[Connection]`/
  `[BrokerPool]` lines while `KafkaService`'s own "Failed to connect to
  Kafka producer; retrying shortly" / "Failed to start consumer ...;
  retrying shortly" lines printed as before; starting Kafka afterward
  showed the genuinely useful kafkajs-native
  `[Consumer] Starting` / `[ConsumerGroup] Consumer has joined the group`
  INFO lines passing through untouched, immediately followed by
  `KafkaService`'s own `Connected to Kafka` / `Consumer
  feed-fanout-consumer subscribed to post.created` lines — still zero
  suppressed-namespace noise throughout.
- **Deviations from spec:** None.

  **Post-review fix (send-path latency — required two attempts):** the
  human flagged that `POST /posts` was taking 20+ seconds to respond when
  Kafka was unreachable — the exact synchronous-retry-inside-the-request
  problem spec 04 already calls out as unwanted, just happening invisibly
  via kafkajs's own default producer retry rather than any code this
  project wrote.

  *First attempt (insufficient — corrected same session):* set the
  producer's own `retry: { retries: 1 }`, since `retries: 0` outright
  (the literal ask) throws at construction for an idempotent producer
  ("Idempotent producer must allow retries to protect against transient
  errors" — confirmed directly against the installed kafkajs) — flagged
  to the human, who chose `retries: 1` over dropping `idempotent: true`.
  Live verification of *that* fix still showed ~21s, disproving it before
  it was reported as done. Root cause, found by reading
  `node_modules/kafkajs/src/producer/sendMessages.js` and
  `.../cluster/brokerPool.js`: a failed `send()` on an already-connected
  producer doesn't consult the producer's own retry option at all for a
  full disconnect — it first tries `cluster.connect()` again, which uses
  the separate *client-level* `retry` (still kafkajs's default 5 retries,
  ~10s), and the resulting `KafkaJSNumberOfRetriesExceeded` is
  unconditionally non-retriable, so the producer-level retry count never
  even gets consulted. This is the same client-level setting
  `connectProducerWithRetry`/`runConsumerWithRetry` (this spec's earlier
  fix) wrap, which the human had asked to leave untouched — flagged as a
  new conflict rather than silently overridden; human chose to lower the
  shared client-level retry anyway, judging the effect on the two loops
  (each attempt now fails in ms instead of ~10s, no change to their
  retry-forever behavior or 5s spacing) a net improvement, not a
  regression.

  *Second attempt (verified working):* client-level `retry: { retries: 0
  }` on the `Kafka` client construction, **plus** keeping the producer-
  level `retry: { retries: 1 }` from the first attempt — dropping the
  producer-level override once the client-level change landed reintroduced
  the exact same construction-time crash as the very first attempt,
  because `Kafka.producer()` merges the client-level retry in as this
  producer's own base default (`{ ...clientRetry, ...producerRetry }`,
  `node_modules/kafkajs/src/index.js`'s `producer()` method) — without an
  explicit override the producer would silently inherit the client's new
  `retries: 0`. Caught this by actually booting the app after the change
  rather than trusting the type-check and unit tests (which don't
  exercise real kafkajs), before reporting anything to the human.
  Verified both values are needed together directly against the installed
  kafkajs (`kafka.producer({ idempotent: true, retry: { retries: 1 } })`
  on a client constructed with `retry: { retries: 0 }` — no throw).
  Verified live end-to-end, three scenarios against a real Kafka
  container: (1) app booted with Kafka already down, `POST /posts` →
  201 in ~74ms (this path fails even faster than the other two, via
  `messageProducer.js`'s own `connectionStatus` check, since the producer
  never reached `CONNECTED` at all) with `[PostsService] Failed to publish
  ... KafkaJSError: The producer is disconnected` logged; (2) producer
  already connected, Kafka stopped mid-flight, `POST /posts` → 201 in
  ~36ms with `[PostsService] Failed to publish ...
  KafkaJSNonRetriableError: Connection error:` logged (matches the
  originally-reported scenario exactly); (3) Kafka back up, `POST /posts`
  → 201 in ~59ms with no failure logged. Baseline with Kafka up throughout
  (no restart) was ~43-53ms before any outage, confirming the fix adds no
  meaningful overhead to the happy path. `nest build`/`tsc --noEmit` clean,
  44 tests passing (unchanged — the mocked-`kafkajs` unit tests don't
  exercise this real-library interaction, which is exactly why the live
  verification mattered here).
- **Deviations from spec:** None.

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

  **Post-review fix (structural):** the human found that if Redis is
  unreachable at application startup (never came up at all, not just "was
  up, then went down"), the app either crashed or failed to accept any
  requests — including `POST /posts`, which never touches Redis — violating
  the fail-open principle already proven for Kafka at the request-path
  level in spec 04. Root cause: `RedisService.onModuleInit` did
  `await this.client.connect()` before resolving, so a failed initial
  connection rejected `onModuleInit` itself and blocked/crashed Nest's
  bootstrap. Per ai-workflow-rules.md's mismatch-handling guidance this was
  treated as a structural fix to the connection lifecycle, not a one-line
  patch: `onModuleInit` no longer awaits the connection — it fires
  `this.client.connect().catch(() => undefined)` (the `.catch` only exists
  to prevent an unhandled-rejection warning from that one explicit call;
  actual error logging still goes through the existing `'error'` listener)
  and returns synchronously, so Nest's bootstrap never waits on Redis.
  Verified against ioredis's own source
  (`node_modules/ioredis/built/redis/event_handler.js`) that reconnection
  is driven independently by the stream's `closeHandler` calling the
  client's `retryStrategy` (exponential backoff, default cap 5s + jitter),
  not by whether the original `connect()` promise was awaited — so
  reconnection behavior is unaffected by this change. Added a `'ready'`
  listener (fires on first connect and every subsequent reconnect) to
  replace the success-log line that used to run after the removed
  `await`. Added `redis.service.spec.ts` (5 tests, none existed before)
  covering: `onModuleInit` doesn't throw/reject when `connect()` rejects,
  the `'ready'`/`'error'` listeners log through `Logger`, `onModuleDestroy`
  disconnects, and `zAdd`/`zRange` still delegate correctly — 33 tests
  passing across all spec files, `tsc --noEmit` clean. Verified live end-to-
  end: with the Redis container stopped, a fresh `npm run start` logged
  `Nest application successfully started` while `[RedisService] Redis
  client error` repeated in the background, and `POST /posts` (plus
  `POST /users`, `POST /follows`) returned 201 normally; starting the Redis
  container afterward (no app restart) produced `[RedisService] Connected
  to Redis` and a subsequent post's fan-out appeared correctly in the
  follower's `feed:{userId}` sorted set — notably, a post created *while*
  Redis was still down also showed up after reconnect, since ioredis's
  default offline command queue held that `zAdd` until the connection came
  back, rather than dropping it.
- **Deviations from spec:** None — spec 01's acceptance criteria ("Redis —
  `ioredis`'s `.connect()` resolves... logs a clear success line on boot")
  describes the happy-path definition of a successful connection, not a
  requirement that a failed connection must block bootstrap, so this fix
  doesn't contradict it.

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
