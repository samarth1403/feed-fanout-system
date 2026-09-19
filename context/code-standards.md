# Code Standards — Feed Fan-Out Backend System

## General principles

- Follow standard NestJS conventions (modules, controllers, services,
  providers via dependency injection) — no deviation for the sake of
  cleverness.
- Business modules (`users`, `follows`, `posts`, `feed`, `search`, `common`)
  are self-contained: their own controller, service, DTOs. No cross-module
  imports of internals — only through exported providers or events.
- Infrastructure modules (`prisma`, `kafka`, `redis`, `elasticsearch`) are
  thin wrappers: connection lifecycle and generic operations only. They
  never contain business logic (e.g. `redis` has `zAdd`/`zRange` helpers,
  not fan-out logic; `elasticsearch` has index/search helpers, not
  ranking/query-building rules).
- Business modules access an external system only through its infrastructure
  module — never by instantiating a client (e.g. `new Redis()`,
  `new PrismaClient()`) directly inside a business module.
- No business logic in controllers. Controllers validate input and delegate;
  services own the logic.

## Infrastructure module startup resilience (applies to all: prisma, kafka, redis, elasticsearch)

No infrastructure module may block NestJS application bootstrap waiting on
a successful connection to its external system. Connection attempts run in
the background (fire-and-retry, not awaited in `onModuleInit`), with
failures logged via the module's own Logger — never left as an unhandled
promise rejection or an unhandled client error event. Each service reports
its own successful (re)connection via an appropriate event/callback once
established.

This was verified against a real cold-start-with-service-down test for all
four modules:

- **redis** — background connect-and-retry; ioredis's own reconnect logic
  runs independently of whether the initial connect is awaited.
- **kafka** — background retry loop for both producer connect and consumer
  subscribe (two separate call sites both needed the fix); kafkajs's own
  connection retry is bounded, so an unbounded outer retry loop is needed
  on top of it.
- **elasticsearch** — background ping-and-retry loop; the ES client itself
  is stateless HTTP per request, so no reconnect logic is needed beyond
  keeping the health-check signal honest.
- **prisma** — different case, documented separately below (Postgres is
  the primary write path, not a secondary dependency to fail open on).

## Prisma is an exception to "fail open" — it fails deliberately instead

Unlike the other three infrastructure modules, Postgres is the source of
truth, not an optional dependency — a write should genuinely fail if
Postgres is unreachable, not silently succeed. `PrismaService.onModuleInit`
does not need the same fire-and-retry pattern (its `$connect()` with the
`@prisma/adapter-pg` driver adapter is already lazy — the underlying
connection pool connects on first query, so it doesn't block bootstrap).
What was fixed instead was the failure _shape_: a Postgres-unreachable
error previously surfaced as a raw, unhandled 500. A shared connection-error
check plus a global `PrismaExceptionFilter` (registered via `APP_FILTER`)
now catches this specific failure mode and returns a clean 503 ("Database
is temporarily unavailable") instead — every other error type (e.g. `P2002`
duplicate-key violations already translated by individual services) passes
through unaffected.

## Naming

- Files: `kebab-case` (`post.service.ts`, `fanout-consumer.ts`)
- Classes: `PascalCase` (`PostsService`, `FeedController`)
- Variables/functions: `camelCase`
- Kafka topics: `dot.case` (`post.created`)
- Redis keys: `colon:namespaced` (`feed:{userId}`)
- DTOs suffixed `Dto` (`CreatePostDto`)

## Error handling

- Use NestJS built-in `HttpException` subclasses (`BadRequestException`,
  `NotFoundException`, etc.) for API-facing errors — never throw raw `Error`
  from a controller or service that's reachable from an HTTP handler.
- Kafka consumer errors do not throw uncaught — they are caught, logged with
  enough context to replay the message, and routed to the dead-letter path
  (see feature spec `09`) rather than crashing the consumer process.
- No silent catches. Every `catch` block either handles the error
  meaningfully or logs and rethrows — never an empty catch.

## Validation

- All incoming request bodies validated via `class-validator` DTOs, not
  manual `if` checks in the controller.

## Async/Kafka conventions

- Kafka consumer handlers must be idempotent — re-processing the same
  `postId` must not double-write to Redis or Elasticsearch (checked via the
  idempotency key, per feature spec `09`).
- No fire-and-forget without a `.catch` — every async operation off the main
  request path (Kafka publish, background job) has explicit error handling.

## Testing expectations

- Each business-module service gets unit tests for its core logic (e.g.
  `FeedService` pagination logic, `PostsService` validation, `FollowsService`
  follow-count consistency).
- Infrastructure modules (`redis`, `elasticsearch`, `kafka`, `prisma`) are
  tested with mocked clients where practical — not against a live broker or
  cluster for unit tests.
- No end-to-end test suite required for MVP — added as final polish
  alongside spec `09`, see `project-overview.md` future scope section.
- Tests live alongside the file they test (`post.service.spec.ts` next to
  `post.service.ts`), standard Nest convention.

## Logging

- Use NestJS's built-in `Logger`, not `console.log`.
- Log at module boundaries: when a Kafka event is consumed, when fan-out
  completes/fails, when a rate limit is hit — enough to trace a single post
  through the whole pipeline from logs alone.

## Environment & config

- All config (DB URL, Kafka broker address, Redis URL, ES URL) via
  `@nestjs/config` and environment variables — never hardcoded.
- `.env.example` committed with placeholder values; `.env` gitignored.
