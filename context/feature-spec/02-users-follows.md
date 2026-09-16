# Feature Spec 02 — Users & Follows Modules

## Goal

Provide the minimum user identity and follow-graph functionality required
for every later spec to be testable end-to-end. Without this, fan-out
(spec 05) has no real followers to fan out to, and posts (spec 03) have no
real authors. Implemented as two separate modules per
architecture-context.md: `users` (identity) and `follows` (relationship
graph) — kept apart because they're distinct concerns even though both
touch the same area of the schema.

## Pre-implementation note: reset the local database

Spec 01 verified Prisma connectivity using `prisma db push`, which syncs
schema directly without creating migration history. Before starting this
spec (which introduces the first real `prisma migrate dev` migration),
wipe the local Postgres volume so it starts from a genuinely clean state
and Prisma doesn't detect drift against the connectivity-check schema:

    docker compose down -v
    docker compose up -d

This is safe — the existing data was only used to verify the connection in
spec 01, nothing worth preserving.

## Scope

### UsersModule

- UsersController, UsersService
- `POST /users` — creates a user (`username`, `followerCount` defaults to 0)
- `GET /users/:id` — fetches a user by id

### FollowsModule

- FollowsController, FollowsService
- `POST /follows` — creates a follow relationship (`followerId`, `followingId`)
- `GET /users/:id/followers` — returns follower count and/or list, used to
  verify fan-out targets during later specs (lives under `/users/:id/...`
  as a URL path for a natural API shape, but is implemented in the
  `follows` module's controller, not the `users` module's)
- `FollowsService.getFollowerIds(userId)` — returns the list of user IDs
  following the given user; used by the fan-out consumer (spec 05)
- `FollowsService.getFollowingIds(userId)` — returns the list of user IDs
  the given user follows; the inverse lookup, used by the celebrity
  read-time merge (spec 09) to find which celebrity accounts a user follows
- `followerCount` on `User` is incremented when a follow is created, in the
  same Prisma transaction as the `Follow` row insert — this is the field the
  celebrity threshold (spec 09) reads, so it must be kept accurate from the
  moment follows exist, not computed on the fly later
- `follows` writes to `User.followerCount` directly via Prisma in its own
  transaction — it does not call into `UsersService` to do this, keeping
  the module boundary clean (no cross-module service calls for a write)

## Out of scope

- Any post, feed, or search behavior
- Unfollow (`DELETE /follows`) — not needed for MVP testing; can be added
  as future scope if useful for demo purposes
- Authentication — `authorId`/`followerId`/`followingId` are passed directly
  in request bodies for this portfolio project, no auth layer in MVP

## CreateUserDto

- `username` (string, required, unique)

## CreateFollowDto

- `followerId` (string, required, must reference an existing user)
- `followingId` (string, required, must reference an existing user, and
  must not equal `followerId`)

## Error handling (per code-standards.md)

- Invalid/missing fields -> `BadRequestException`
- `followerId`/`followingId` referencing a non-existent user -> `NotFoundException`
- `followerId === followingId` -> `BadRequestException` ("cannot follow self")
- Duplicate follow (same pair already exists) -> `BadRequestException`,
  not a raw Prisma unique-constraint error

## followerCount consistency

- Incrementing `followerCount` on follow-creation happens in the same
  Prisma transaction as the `Follow` row insert, so the counter can never
  drift out of sync with actual follow rows.

## Acceptance criteria

- `POST /users` creates a user and returns it
- `POST /follows` creates a follow relationship and correctly increments
  `followingId`'s `followerCount`
- Attempting to follow a non-existent user, follow yourself, or create a
  duplicate follow all return appropriate 4xx errors, not raw DB errors
- `GET /users/:id/followers` returns accurate data usable for verifying
  fan-out in spec 05
- `FollowsService.getFollowerIds()` and `getFollowingIds()` both return
  correct results against a small test follow graph
- `UsersModule` and `FollowsModule` are registered as separate NestJS
  modules with no cross-module service calls
