# Project Overview — Feed Fan-Out Backend System

## Goal

A backend-only feed fan-out system (Twitter/Instagram-style). No UI — the
system is delivered via README, architecture diagram, and API docs
(Postman/Swagger). It's scoped around the classic "Design Twitter" system
design problem, with a deliberate focus on the parts that make fan-out
architectures hard in practice, not just a CRUD app with a queue attached.

## Development approach: spec-driven, agentic

Built using a context-file + feature-spec-file workflow: specs are written
and locked before any code is generated, and every generated file is
reviewed against its spec. Context files capture the durable decisions
(architecture, conventions, scope); numbered feature specs map 1:1 to
implementation units.

## Tech stack + why

- **NestJS** — backend framework
- **PostgreSQL + Prisma** — source of truth for users, posts, and follows
- **Kafka** — decouples "accept a post" from "propagate to N followers" via a
  `post.created` event, published on post creation and consumed asynchronously
- **Redis** — per-user feed as a sorted set (post ID, timestamp) for O(log n)
  feed reads; also backs the rate limiter on the post-creation endpoint
- **Elasticsearch** — full-text/hashtag search across posts; a separate read
  path from the feed (relevance/tokenization vs. simple sorted retrieval)

## Locked MVP scope (9 items — nothing added mid-build)

1. Setup: NestJS project, Postgres, Docker Compose for Kafka/Redis/ES locally
2. Users & Follows module + DB schema (Prisma)
3. Posts module
4. Kafka producer — publishes `post.created` event
5. Kafka consumer — fans out post ID to each follower's Redis sorted set
6. `GET /feed` — reads from Redis
7. Elasticsearch indexing + `GET /search?q=`
8. Redis-based rate limiter on post creation
9. README + architecture diagram + cleanup

## The three "non-tutorial" additions (required, not optional)

- **Fan-out-on-write vs. fan-out-on-read** at a follower-count threshold (the
  "celebrity problem") — skip fan-out for high-follower accounts, merge at
  read-time instead. **This mechanism is a required part of the locked design.**
  The specific threshold value and read-time merge query are worked out in
  feature spec `09-celebrity-threshold-and-resilience.md`, not decided here —
  same as other low-level implementation details (e.g. Kafka partition count)
  that belong in their feature spec rather than the overview.
- **Consumer lag / backpressure handling** — what happens if the fan-out
  consumer falls behind a burst of posts
- **Dead-letter/retry path** for failed consumer jobs, plus an idempotency key
  so a redelivered Kafka message doesn't double fan-out

## Explicitly rejected approaches

- Forking/closely following any tutorial repo's structure or codebase
- Solving/designing the celebrity fan-out mechanism now — parked until its
  dedicated feature spec

## Future scope (not part of this build)

- WebSocket push for real-time feed updates
- Cursor-based pagination on feed reads
- Basic metrics/observability dashboard
- Unfollow functionality
- Authentication
- Transactional outbox pattern for the post-creation write + Kafka publish,
  to close the gap where a post can be durably stored but never fan out if
  the publish fails (see `04-kafka-producer.md`)
- Any tech, endpoint, or feature not listed in the 9 locked MVP items above
