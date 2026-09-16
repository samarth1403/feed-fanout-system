# Feature Spec 03 — Posts Module

## Goal

Implement the Posts module: create a post and persist it to PostgreSQL,
using the real users created via the Users & Follows module (spec 02). No
Kafka publishing in this spec — that's wired in when the producer exists
(spec 04).

## Scope

- PostsModule: PostsController, PostsService
- `POST /posts` — creates a post, persists to Postgres, returns the created
  record
- `GET /posts/:id` — fetches a single post by id (useful for verifying
  creation during this spec and for debugging later)
- Input validation via class-validator DTO (`CreatePostDto`)
- `authorId` must reference a real user created via spec 02's `POST /users`

## Out of scope (belongs to later specs)

- Publishing `post.created` to Kafka -> spec 04 (this spec's `POST /posts`
  persists only; spec 04 extends it to also publish)
- Any feed or search behavior
- Any Kafka, Redis, or Elasticsearch interaction

## Prisma schema

Defined in spec 02 (`User`, `Post`, `Follow` all live in the same schema).
No schema changes in this spec — `Post` is already modeled.

## CreatePostDto

- `authorId` (string, required, must be a valid existing user id)
- `content` (string, required, non-empty, reasonable max length e.g. 500 chars)

## Error handling (per code-standards.md)

- Invalid/missing fields -> `BadRequestException`
- `authorId` referencing a non-existent user -> `NotFoundException`
- No silent catches; Prisma errors are caught and translated into the
  appropriate `HttpException`

## Acceptance criteria

- `POST /posts` with a valid `authorId` (created via spec 02) and `content`
  creates a row and returns it
- `POST /posts` with an invalid `authorId` returns 404, not a raw Prisma error
- `GET /posts/:id` returns the post or 404
- No Kafka event is published yet (verified: no producer code exists at
  this point in the build)
