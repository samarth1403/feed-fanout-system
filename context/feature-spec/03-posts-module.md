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

`Post` is added in this spec (not spec 02 — spec 02 added only `User` and
`Follow`). Shape per architecture-context.md:

```prisma
model Post {
  id        String   @id @default(uuid())
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  content   String
  createdAt DateTime @default(now())
}
```

This requires adding the corresponding `posts Post[]` relation field to the
existing `User` model, and a new migration (`prisma migrate dev`) — this
spec's own migration, separate from spec 02's.

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
