# Feature Spec 05 — Kafka Consumer & Fan-Out

## Goal

Consume the `post.created` event (published in spec 04) and fan the post out
to every follower's feed by writing into their Redis sorted set. This is the
core mechanic the whole system is built around.

## Module placement

- `kafka` module owns the generic Kafka client/consumer wiring (connect,
  disconnect, subscribe helper) — no business logic here.
- `feed` module owns the actual `post.created` handler: it uses the `kafka`
  module's consumer wiring to subscribe to the topic, and contains the
  fan-out logic itself.
- `redis` module (infrastructure) provides generic sorted-set operations
  (`zAdd`, `zRange`, etc.) — `feed` calls into it for fan-out writes; it
  contains no fan-out logic of its own.
- Follower lookups go through `FollowsService` (imported from the `follows`
  module), not a direct Prisma query from `feed` — consistent with the
  no-cross-module-storage-access rule in architecture-context.md.

## Kafka consumer configuration

- Consumer group: `feed-fanout-consumer`
- Subscribes to topic: `post.created`
- One consumer instance for MVP — no partition-based scaling concerns at
  this scope
- Consumption mode (`eachBatch` vs `eachMessage`), fetch-size configuration,
  and backpressure handling are finalized in spec 09 — the per-message
  fan-out logic below applies to each message within whatever batch the
  consumer receives, once spec 09 configures batch mode.

## Fan-out logic (per message)

1. Parse the `post.created` payload (`postId`, `authorId`, `createdAt`).
2. Call `FollowsService.getFollowerIds(authorId)` to get the list of users
   following the author.
3. For each follower ID, call `RedisService.zAdd('feed:{followerId}', createdAt, postId)`.
4. Log completion with `postId` and follower count fanned out to.

## Design note: natural idempotency at the data-structure level

Because a Redis sorted set has unique members, re-adding the same `postId`
to the same follower's feed via `zAdd` does not create a duplicate entry —
it just updates the score if the member already exists. This means a
message redelivered by Kafka and reprocessed does not corrupt an individual
follower's feed with duplicate entries.

This is a useful property, but it is not the same thing as full
consumer-level idempotency: it doesn't address a fan-out that fails partway
through a large follower list, or provide a record of which messages have
already been fully processed. That is designed properly in spec 09 — this
note documents why the naive version isn't immediately broken, not a
substitute for that design.

## Out of scope (deferred to spec 09)

- Celebrity follower-count threshold check (skipping fan-out for
  high-follower authors) — this spec fans out to all followers unconditionally,
  regardless of follower count
- Consumer lag / backpressure handling
- Dead-letter queue and retry logic
- Formal idempotency key / processed-message tracking

## Out of scope (belongs to other specs)

- `GET /feed` read endpoint -> spec 06
- Elasticsearch indexing (a separate consumer of the same event) -> spec 07

## Error handling (per code-standards.md)

- If `FollowsService.getFollowerIds()` throws, the error is caught and
  logged with the `postId` — the message is not silently dropped, but for
  this spec there is no retry or DLQ yet (that's spec 09); the failure is
  visible in logs only
- Redis write failures per-follower are caught and logged individually via
  `RedisService`, rather than aborting the entire fan-out for one bad write

## Acceptance criteria

- Creating a post via `POST /posts` (with real followers set up via spec 02)
  results in the post ID appearing in each follower's `feed:{userId}` sorted
  set in Redis, verifiable via `redis-cli ZRANGE feed:{userId} 0 -1`
- A user with no followers produces a `post.created` event that is consumed
  without error and results in zero Redis writes (not a crash)
- Manually re-publishing the same `post.created` message does not create
  duplicate entries in any follower's sorted set (per the idempotency note
  above)
