# Feature Spec 07 — Elasticsearch Indexing & Search

## Goal

Index posts into Elasticsearch as they're created, and expose `GET /search`
for full-text lookup across post content. This is a separate read path from
the feed — different problem (relevance/tokenization), different consumer
of the same event.

## Module placement

- `elasticsearch` module (infrastructure) provides a generic client wrapper:
  `indexDocument`, `search` — no query-building or ranking logic lives here.
- `search` module owns `SearchController` and `SearchService`:
  - `SearchService` subscribes to `post.created` (via the `kafka` module's
    consumer wiring, its own consumer group, independent from `feed`'s) and
    calls `ElasticsearchService.indexDocument()` to index the post
  - `SearchService` also owns `GET /search`, building the actual query and
    calling `ElasticsearchService.search()`
- `search` does not query Postgres directly to build the index — it only
  ever indexes what arrives via the `post.created` event, consistent with
  architecture-context.md's no-cross-module-storage-access rule.

## Kafka consumer configuration

- Consumer group: `search-indexer-consumer` — deliberately separate from
  `feed-fanout-consumer` (spec 05), so the two consumers process the same
  topic independently. If Elasticsearch is slow or down, it does not affect
  Redis fan-out, and vice versa.
- Subscribes to topic: `post.created`
- Consumption mode (`eachBatch` vs `eachMessage`), fetch-size configuration,
  and backpressure handling are finalized in spec 09 — the per-message
  indexing logic below applies to each message within whatever batch the
  consumer receives, once spec 09 configures batch mode.

## Elasticsearch index shape (per architecture-context.md)

Index: `posts`

- `postId` (keyword — exact match, used for lookups/dedup)
- `authorId` (keyword)
- `content` (text — analyzed for full-text search)
- `createdAt` (date)

## Indexing logic (per message)

1. Parse the `post.created` payload (`postId`, `authorId`, `createdAt`).
   Note: the event does not carry `content` (per the minimal event contract
   in architecture-context.md) — the consumer fetches the full post via
   `PostsService.findById(postId)` before indexing.
2. `ElasticsearchService.indexDocument('posts', postId, { postId, authorId, content, createdAt })`.
   Using `postId` as the Elasticsearch document ID makes indexing naturally
   idempotent — re-indexing the same `postId` overwrites the existing
   document rather than creating a duplicate.
3. Log completion with `postId`.

## Search endpoint

`GET /search?q={query}&limit={limit}`

- `q` (required, non-empty) — search term matched against `content`
- `limit` (optional, default 20, max 50)

## Search logic

1. Validate `q` is non-empty; `BadRequestException` if not.
2. `ElasticsearchService.search('posts', { match: { content: q } }, limit)`.
3. Return matching posts, most-relevant first (Elasticsearch's default
   relevance scoring — no custom ranking logic for MVP).

## Response shape

```json
[
  {
    "postId": "uuid",
    "authorId": "uuid",
    "content": "string",
    "createdAt": "ISO timestamp"
  }
]
```

## Out of scope

- Hashtag-specific parsing/extraction — full-text match against raw content
  is sufficient for MVP; hashtags are just words within `content` for now
- Search result pagination beyond a flat `limit` — no cursor/offset paging,
  consistent with the feed endpoint's MVP-level pagination
- Any relevance tuning, synonyms, or fuzzy matching beyond Elasticsearch's
  defaults
- Backfilling the index for posts created before this spec existed — not
  needed since this is a fresh build, no historical data to migrate

## Error handling (per code-standards.md)

- Elasticsearch indexing failures during consumption are caught, logged
  with `postId`, and do not crash the consumer — consistent with spec 05's
  approach for Redis fan-out failures. No DLQ/retry yet (spec 09 covers
  resilience for both consumers)
- `GET /search` with empty `q` -> `BadRequestException`
- Elasticsearch query failure -> caught, logged, surfaced as 500

## Note: DLQ/idempotency scope boundary

Feature spec 09 covers backpressure handling, dead-letter/retry logic, and
idempotency keys for **both** Kafka consumers — `feed-fanout-consumer`
(spec 05) and `search-indexer-consumer` (this spec) — since both consume
the same `post.created` event and share the same failure modes (consumer
lag, message redelivery, partial failure). This spec's error handling
(log-only, no DLQ) is a placeholder that spec 09 replaces for both
consumers, not a permanent gap specific to search.

## Acceptance criteria

- Creating a post via `POST /posts` results in a searchable document in the
  `posts` Elasticsearch index within a short delay
- `GET /search?q={word}` returns posts containing that word in `content`
- `GET /search` with no `q` returns 400
- Re-publishing the same `post.created` message does not create a duplicate
  document (per the idempotent indexing note above)
- Killing Elasticsearch and creating a post still succeeds end-to-end for
  the write path and Redis fan-out (spec 05) — only search indexing fails,
  logged, without affecting the rest of the system
