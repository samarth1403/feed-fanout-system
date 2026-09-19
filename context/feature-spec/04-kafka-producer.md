# Feature Spec 04 — Kafka Producer

## Goal

Extend post creation (from spec 03) to publish a `post.created` event to
Kafka after the post is persisted to Postgres. This is what decouples "post
accepted" from "post fanned out" — the consumer side (spec 05) is what
actually reacts to this event.

## Scope

- Kafka module: producer setup, connection lifecycle (connect on app
  bootstrap, disconnect on shutdown)
- Topic: `post.created`
- `PostsService.create()` (from spec 03) is extended to publish the event
  after the Postgres write succeeds
- Kafka client: KafkaJS (standard, well-supported NestJS integration)

## Kafka event contract (per architecture-context.md)

`post.created` payload:

- `postId` (string)
- `authorId` (string)
- `createdAt` (ISO timestamp string)

No follower list in the event — the consumer looks up followers itself
(spec 05). This keeps the producer simple and ignorant of fan-out logic.

## Producer configuration

- Idempotent producer enabled (KafkaJS `idempotent: true`) — protects
  against duplicate publishes if the producer retries a send internally,
  independent of the consumer-side idempotency key in spec 09
- `acks: 'all'` — wait for the event to be durably written to the topic
  before considering the publish successful, not just accepted by the
  leader broker
- Client-level `retries: 0` — if the client cannot reach a broker at all
  (connection-level failure), fail immediately rather than retrying the
  connection internally for 10+ seconds. This is required so a Kafka
  outage fails fast per the "publish failure" design decision below,
  instead of silently blocking POST /posts for 20+ seconds while kafkajs
  retries a dead connection under the hood.
- Producer-level `retries: 1` — the minimum value kafkajs requires when
  `idempotent: true` is set (an idempotent producer must be able to retry
  at least once by definition); this is a library constraint, not a
  deliberate resilience choice.
- Single-partition topic is sufficient for local/MVP scale; partition
  strategy is not a tuning concern for this project

## Design decision: what happens if the Kafka publish fails

The post is already committed to Postgres by the time the publish is
attempted — the write and the publish are not one atomic operation. If
Kafka is unreachable or the publish times out, the request does not roll
back or fail, and the publish is not retried synchronously inside the
request.

This follows directly from the system's own design goal: Kafka exists to
decouple accepting a post from propagating it. Making post creation depend
on Kafka being healthy would reintroduce the coupling the architecture is
built to avoid.

A failed publish is caught and logged with enough detail to identify the
affected post. The post exists in Postgres but will not appear in feeds or
search until its event is manually replayed. This is a known, deliberate
MVP limitation, not an oversight.

## Known limitation and possible extension

The write (Postgres) and the publish (Kafka) are not part of a single
atomic operation, so a narrow window exists where a post is durably stored
but never fans out. A transactional outbox pattern — writing the event to
an outbox table in the same Postgres transaction as the post, with a
separate process guaranteeing eventual delivery to Kafka — would close this
gap. It is not implemented here: it adds meaningfully more infrastructure
than this system's scope calls for, and is documented here as a deliberate
scope boundary rather than a missing feature.

## Error handling (per code-standards.md)

- Publish failures are caught in `PostsService`, logged via NestJS `Logger`
  with `postId` and the error, and swallowed (per the design decision above)
  — they do not propagate as an exception to the controller
- Producer connection failures on app bootstrap do fail loudly (the app
  should not start in a state where it silently can't publish at all)

## Out of scope (belongs to later specs)

- Consuming `post.created` / fan-out logic -> spec 05
- Dead-letter queue, retry policy, idempotency key -> spec 09 (these are
  consumer-side concerns; the producer here only publishes once, best-effort)

## Acceptance criteria

- Creating a post via `POST /posts` results in a `post.created` message on
  the topic, visible via a Kafka consumer console tool for manual
  verification
- Killing the Kafka container and then calling `POST /posts` still returns
  a successful response (post is created in Postgres) and logs a clear
  publish-failure message, per the design decision above
- Restarting Kafka and creating a new post afterward publishes successfully
  again — no producer-side crash or stuck state from the earlier failure
