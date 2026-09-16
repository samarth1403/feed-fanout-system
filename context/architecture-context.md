# Architecture Context — Feed Fan-Out Backend System

## Data flow (end to end)

**Write path:**

1. Client sends `POST /posts` to the API.
2. API persists the post in PostgreSQL (source of truth).
3. API publishes a `post.created` event to Kafka and returns a response —
   fan-out does not block the write.

**Fan-out path (async, triggered by the event):** 4. Kafka consumer picks up `post.created`. 5. For each follower of the poster, the consumer pushes the post ID into that
follower's Redis sorted set (score = post timestamp) — unless the poster
is above the celebrity follower-count threshold, in which case fan-out is
skipped for that post (see feature spec `09`). 6. The same event also triggers indexing of the post into Elasticsearch, for
search — independent of the Redis fan-out.

**Read paths:**

- `GET /feed` reads the requesting user's Redis sorted set, paginated by
  score. If the user follows any celebrity accounts, their recent posts are
  merged in at read time (mechanism defined in feature spec `09`).
- `GET /search?q=` queries Elasticsearch directly.

## Service / module boundaries

**Business modules** (own domain logic, no direct external-client code):

- **users** — owns User identity data; exposes user creation and lookup
- **follows** — owns Follow relationship data; exposes follow creation and
  follower lookups; keeps `User.followerCount` accurate on every follow
  write
- **posts** — accepts writes, persists via `prisma`, publishes `post.created`
  via `kafka`
- **feed** — consumes `post.created` (via `kafka`) and fans out using
  `redis`; exposes `GET /feed`
- **search** — consumes `post.created` (via `kafka`) and indexes using
  `elasticsearch`; exposes `GET /search`
- **common** — cross-cutting business concerns only: guards, interceptors,
  and the rate limiter's logic (which itself calls into `redis` for its
  operations)

**Infrastructure modules** (thin wrappers around one external system —
connection lifecycle and generic operations only, no business logic):

- **prisma** — `PrismaService` wrapping `PrismaClient`; connection lifecycle
- **kafka** — producer/consumer client wiring, connect/disconnect, generic
  publish/subscribe helpers
- **redis** — client + generic operations (`zAdd`, `zRange`, etc.) — no
  fan-out logic and no rate-limit logic live here
- **elasticsearch** — client + generic index/search helpers — no
  search-ranking or query-building logic lives here

No business module reaches into another business module's storage directly
(e.g. `search` never queries Postgres directly for indexing — it consumes
the event; `posts` never writes to the `Follow` table — it only reads
`authorId` it's given). Business modules talk to external systems only
through the relevant infrastructure module, never by instantiating a client
directly.

## Schema shape (PostgreSQL, via Prisma)

**User**

- `id` (uuid, PK)
- `username`
- `followerCount` (denormalized counter, kept in sync on every follow write,
  used for the celebrity threshold check without a COUNT query on every post)
- `createdAt`

**Post**

- `id` (uuid, PK)
- `authorId` (FK → User)
- `content`
- `createdAt`

**Follow**

- `followerId` (FK → User)
- `followingId` (FK → User)
- composite PK on (`followerId`, `followingId`)

This is intentionally minimal — no likes, comments, or media, since those
aren't in the locked MVP scope.

## Kafka event contract

`post.created`:

- `postId`
- `authorId`
- `createdAt`

Consumers look up follower lists and celebrity status themselves rather than
the event carrying a follower list — keeps the event small and the producer
ignorant of fan-out logic.

## Redis key structure

- `feed:{userId}` — sorted set, member = `postId`, score = post timestamp

## Elasticsearch index shape

- One index for posts: `postId`, `authorId`, `content`, `createdAt` —
  enough for full-text search over content, no separate mapping complexity
  for v1.
