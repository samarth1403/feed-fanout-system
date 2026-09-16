# Feature Spec 08 — Rate Limiter

## Goal

Rate-limit `POST /posts` per user, using Redis, to prevent a single user
(or a bug/script) from flooding the system with posts and triggering
excessive fan-out load.

## Module placement

- Rate limiter logic (the actual algorithm) lives in `common` — it's a
  cross-cutting concern, not owned by `posts` specifically, since the same
  mechanism could apply to other endpoints later.
- It calls `RedisService` (from the `redis` infrastructure module) for its
  counter operations — it does not talk to Redis directly, consistent with
  the infrastructure-module rule in architecture-context.md.
- Implemented as a NestJS Guard (`RateLimitGuard`) applied to `POST /posts`,
  rather than logic inside `PostsController` or `PostsService` — keeps rate
  limiting orthogonal to the post-creation logic itself.

## Algorithm

Fixed-window counter per user:

- Redis key: `ratelimit:posts:{userId}`
- On each `POST /posts` request: increment the counter (`INCR`); if this is
  the first increment in the window, set an expiry (`EXPIRE`) matching the
  window length
- If the counter exceeds the configured limit before the window expires,
  reject the request

Chosen over a sliding-window or token-bucket algorithm because it's simpler
to reason about and sufficient for this project's purpose (protecting fan-
out load, not precise traffic shaping) — a fixed window's edge-case burst
(2x limit across a window boundary) is an accepted tradeoff, not a gap to
close later.

## Configuration

- Limit: 5 posts per user per 60-second window (values configurable via
  environment variables, not hardcoded, per code-standards.md)
- `RATE_LIMIT_POSTS_MAX` and `RATE_LIMIT_POSTS_WINDOW_SECONDS` added to
  `.env.example`

## Guard behavior

1. Extract `userId` from the request body (no auth layer in MVP, so
   `userId` is read the same way `posts` and `feed` already read it —
   directly from the request, not from a session/token).
2. Check and increment the Redis counter via `RedisService`.
3. If under the limit, allow the request through.
4. If over the limit, reject with `429 Too Many Requests` before the
   request reaches `PostsController` — no post is created, no Kafka event
   is published.

## Error handling (per code-standards.md)

- Limit exceeded -> `HttpException` with status 429, clear message
  including retry-after context (time remaining in the current window)
- Redis failure while checking the limit -> fails open (request is allowed
  through), logged as a warning. Reasoning: a rate limiter's job is to
  protect the system from abuse, not to become a single point of failure
  that blocks legitimate posts if Redis has a transient issue. This is a
  deliberate choice, not an oversight — flagged here in case you'd rather
  fail closed instead.

## Out of scope

- Per-IP rate limiting — user-based only, since IP-based limiting matters
  more for unauthenticated/anonymous abuse, which isn't a concern without
  an auth layer in MVP
- Rate limiting any endpoint other than `POST /posts`
- Sliding-window or token-bucket algorithms

## Acceptance criteria

- A user posting within the limit succeeds normally every time
- A user exceeding the limit within the window receives 429 on the request
  that crosses the threshold, and no post/event is created for that request
- After the window expires, the same user can post again
- Killing Redis and then posting still returns a successful post creation
  (fail-open behavior), with a warning logged
