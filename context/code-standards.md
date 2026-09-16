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
