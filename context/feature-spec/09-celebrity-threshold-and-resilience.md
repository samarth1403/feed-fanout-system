# Feature Spec 09 — Celebrity Threshold & Resilience

## Goal

Complete the three mandatory non-tutorial additions: fan-out-on-write vs.
fan-out-on-read switching at a follower-count threshold, consumer lag/
backpressure handling, and a dead-letter/retry path with idempotency keys —
applied to **both** Kafka consumers (`feed-fanout-consumer` from spec 05,
`search-indexer-consumer` from spec 07), per the earlier decision to make
resilience consistent across both.

---

## Part 1 — Celebrity threshold (fan-out-on-write vs. fan-out-on-read)

### Mechanism

- Config: `CELEBRITY_FOLLOWER_THRESHOLD` (env var, e.g. `10000`).
- When `feed-fanout-consumer` processes a `post.created` event, it checks
  the author's `User.followerCount` (already denormalized, kept accurate by
  the `follows` module since spec 02).
- **Below threshold:** fan-out proceeds exactly as spec 05 — write to every
  follower's `feed:{followerId}` sorted set.
- **At or above threshold:** per-follower fan-out is skipped entirely.
  Instead, the post is written once to a separate sorted set:
  `celebrity_posts:{authorId}` (score = timestamp). This avoids writing to
  potentially millions of follower sorted sets for one post.

### Read-time merge (`GET /feed`, extending spec 06)

1. Fetch the user's normal feed from `feed:{userId}` as spec 06 already does.
2. Fetch the list of accounts the user follows via a new
   `FollowsService.getFollowingIds(userId)` method (spec 02's `follows`
   module only exposed follower lookups; this adds the inverse — a small,
   expected addition, not a scope change).
3. Filter that list to accounts where `User.followerCount >= threshold`
   (via `UsersService`).
4. For each celebrity followee, read their `celebrity_posts:{authorId}`
   sorted set (most recent few, e.g. top 5) instead of scanning Postgres.
5. Merge the two result sets by timestamp, then apply `limit`/`offset` as
   spec 06 defines.

This mirrors the real "Design Twitter" answer: fan-out-on-write for normal
users (cheap reads, since the work happened at write time), fan-out-on-read
for celebrities (cheap writes, since one post shouldn't fan out to millions
of sorted sets; the read side pays a small, bounded merge cost instead).

### Out of scope

- Any UI/flagging of "celebrity" status to users — this is purely a backend
  optimization, invisible to the API's response shape
- Making the threshold per-user configurable — one global threshold for MVP

---

## Part 2 — Consumer lag / backpressure handling

### Approach

- Both consumers switch from per-message processing (`eachMessage`) to
  batch processing (`eachBatch`), processing followers within a batch with
  bounded concurrency (e.g. 10 concurrent Redis/Elasticsearch writes at a
  time) rather than firing all writes for a batch simultaneously. This
  prevents one large-follower-count post from saturating Redis/ES
  connections in an uncontrolled burst.
- Consumer lag (how far behind the consumer is from the latest message on
  the topic) is checked periodically via the Kafka admin client, comparing
  the consumer group's committed offset to the topic's latest offset.
- If lag exceeds a configured threshold (`CONSUMER_LAG_WARNING_THRESHOLD`),
  it's logged as a warning with the current lag count — visible operational
  signal, not an automatic scaling action (out of scope, see below).

### Out of scope

- Auto-scaling consumer instances or partitions in response to lag —
  meaningfully more infrastructure (K8s HPA, multiple partitions/consumers)
  than this project's scope; logging lag is the deliverable, reacting to it
  automatically is future scope
- Any circuit-breaker pattern that pauses the consumer entirely — bounded
  concurrency is the chosen mitigation, not consumer pausing

---

## Part 3 — Dead-letter queue, retry, and idempotency (shared across both consumers)

### Shared handler

A reusable wrapper lives in the `kafka` infrastructure module —
`processWithResilience(message, handlerFn, consumerName)` — used by both
`feed-fanout-consumer` and `search-indexer-consumer`, so the retry/DLQ/
idempotency logic is written once, not duplicated per consumer.

### Idempotency key

- Redis key: `processed:{consumerName}:{postId}` (e.g.
  `processed:feed-fanout:abc123`), set with a TTL (e.g. 24 hours — long
  enough to cover realistic redelivery windows, not kept forever).
- Before processing a message, the handler checks this key. If present, the
  message is skipped (already processed) and the offset is committed
  without reprocessing.
- After successful processing, the key is set.
- This is the formal idempotency guarantee referenced as deferred in specs
  05 and 07 — it's stronger than the "Redis sorted set naturally dedupes"
  note from spec 05, since it also prevents redundant Elasticsearch
  re-indexing work and redundant lookups, not just duplicate writes.

### Retry

- On a processing error, retry in-process up to 3 times with exponential
  backoff (e.g. 500ms, 1s, 2s) before giving up on that message.

### Dead-letter queue

- If all retries fail, the message is published to a DLQ topic
  (`post.created.dlq`, and `post.created.search.dlq` — separate DLQ topics
  per consumer, since a fan-out failure and a search-indexing failure are
  different problems with potentially different fixes) with the original
  payload plus error context (error message, timestamp, retry count).
- After publishing to the DLQ, the original message's offset is committed
  — the consumer moves on rather than getting stuck retrying the same
  message forever.
- DLQ messages are not automatically replayed in this project — replay is
  a manual operational action (e.g. a script that reads the DLQ topic and
  republishes to the main topic), out of scope to automate for MVP.

### Out of scope

- Automatic DLQ replay/reprocessing
- Alerting integration (e.g. paging on DLQ message count) — logging is the
  deliverable

---

## Config additions (update `.env.example` in `01-setup.md`)

- `CELEBRITY_FOLLOWER_THRESHOLD`
- `CONSUMER_LAG_WARNING_THRESHOLD`

## Acceptance criteria

- A post from an author above the threshold does not appear in any
  individual follower's `feed:{userId}` set, but does appear in
  `celebrity_posts:{authorId}`
- `GET /feed` for a user following a celebrity account returns that
  celebrity's recent posts merged in, correctly ordered by timestamp
  alongside normal fanned-out posts
- Consumer lag exceeding the configured threshold produces a visible
  warning log
- A message that fails processing 3 times lands in the appropriate DLQ
  topic, and the main consumer continues processing subsequent messages
  without getting stuck
- Re-delivering an already-processed message (same `postId`, same
  consumer) is skipped due to the idempotency key, with a log line
  indicating it was skipped rather than reprocessed
