# Feature Spec 06 — Feed Read Endpoint

## Goal

Expose `GET /feed`, reading the requesting user's Redis sorted set (fanned
out to in spec 05) and returning the actual post content, newest first.

## Module placement

- `feed` module owns `FeedController` and `FeedService`.
- `FeedService` calls `RedisService` (from the `redis` infrastructure
  module) to read the sorted set, and `PostsService` (from the `posts`
  business module, via its exported provider) to hydrate post IDs into full
  post objects. This is a business-module-to-business-module call, allowed
  per architecture-context.md since it goes through an exported provider,
  not direct storage access.
- `feed` does not query Postgres directly for post content — it always goes
  through `PostsService`.

## Endpoint

`GET /feed?userId={userId}&limit={limit}&offset={offset}`

- `userId` (required) — no auth layer in MVP, so the caller is identified
  explicitly rather than inferred
- `limit` (optional, default 20, max 50) — number of posts to return
- `offset` (optional, default 0) — for simple pagination

## Read logic

1. Validate `userId` exists (via `UsersService`); if not, `NotFoundException`.
2. `RedisService.zRevRange('feed:{userId}', offset, offset + limit - 1)` —
   returns post IDs newest-first (score = timestamp, descending).
3. If no post IDs are returned, respond with an empty array — this is a
   normal state (new user, or a user who isn't followed by anyone posting
   yet), not an error.
4. For the returned post IDs, call `PostsService.findManyByIds(postIds)` to
   fetch full post records from Postgres.
5. Return posts in the same newest-first order as step 2 (Postgres does not
   guarantee return order matches the input ID list, so the service
   re-orders the hydrated results to match the Redis order before
   responding).

## Pagination approach (MVP)

Simple `limit`/`offset` against the sorted set. This is not cursor-based
pagination — cursor-based pagination is listed as future scope in
project-overview.md. Offset-based pagination against a Redis sorted set is
consistent (unlike SQL offset pagination, it doesn't have a real
performance cliff at this scale), so it's an acceptable MVP choice rather
than a corner cut.

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

## Out of scope (belongs to other specs)

- Celebrity read-time merge (posts from celebrity accounts the user follows,
  not present in their Redis sorted set because fan-out was skipped for
  those posts) -> spec 09
- Cursor-based pagination -> future scope, not this spec
- Any caching of feed responses beyond what Redis already provides

## Error handling (per code-standards.md)

- `userId` not found -> `NotFoundException`
- `limit` above the max or a negative `offset` -> `BadRequestException`
- Redis read failure -> caught, logged, and surfaced as a 500 — no silent
  empty-array fallback that would mask an actual outage as "no posts"

## Acceptance criteria

- After fan-out (spec 05) has run for a post, `GET /feed?userId={followerId}`
  returns that post, newest first
- A user with no posts fanned out to them yet returns an empty array, not
  an error
- `limit` and `offset` correctly page through a feed with more posts than
  one page's worth
- A non-existent `userId` returns 404
