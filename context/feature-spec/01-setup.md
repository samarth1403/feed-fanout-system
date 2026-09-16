# Feature Spec 01 — Project Setup

## Goal

Stand up the NestJS project skeleton and local infrastructure (Postgres,
Kafka, Redis, Elasticsearch) via Docker Compose, so every later feature spec
has a working environment to build against. No business logic in this spec —
just scaffolding, config, and module boundaries.

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

- Initialize a NestJS project
- Set up Prisma with a PostgreSQL connection, wrapped in a `PrismaModule`/
  `PrismaService` (schema itself comes in spec 02)
- Docker Compose file running Postgres, Kafka in KRaft mode (no Zookeeper),
  Redis, and Elasticsearch locally
- Create empty module skeletons for the boundaries defined in
  architecture-context.md:
  - Business modules: users, follows, posts, feed, search, common
  - Infrastructure modules: prisma, kafka, redis, elasticsearch
- Environment/config setup per code-standards.md (@nestjs/config,
  .env.example)
- Base logging setup using NestJS's built-in Logger

## Prisma is ORM-only, against our own Postgres container

Prisma here is a query-builder/ORM layer only, connecting to the
self-hosted Postgres container defined in this spec's Docker Compose. This
is not Prisma's own hosted database product (Prisma Postgres) or any part
of Prisma's Data Platform/Accelerate offerings — those are separate,
unrelated products from the same company. `DATABASE_URL` always points at
the local (or later, self-hosted production) Postgres instance.

## Client libraries (locked choices)

The tech stack (project-overview.md) names Kafka, Redis, and Elasticsearch
without prescribing specific client libraries. These are the chosen
implementations, locked here so later specs don't re-decide:

- Kafka: `kafkajs`
- Redis: `ioredis`
- Elasticsearch: `@elastic/elasticsearch`

Do not introduce alternative libraries for these three concerns in a later
spec without flagging it first, per ai-workflow-rules.md.

## Out of scope (belongs to later specs)

- Prisma schema / actual DB models -> spec 02
- Kafka producer/consumer logic -> specs 04, 05
- Redis sorted-set logic -> spec 06
- Elasticsearch indexing/query logic -> spec 07
- Rate limiter implementation -> spec 08
- `class-validator` / `class-transformer` — not installed in this spec;
  this spec has no DTOs. They're introduced when the first DTO is actually
  needed (spec 02's `CreateUserDto`/`CreateFollowDto`), not preemptively.

## Docker Compose services

- postgres — exposed on a local port, with a persisted volume. Credentials
  are never hardcoded in docker-compose.yml — they're referenced as
  `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}`, `${POSTGRES_DB}`, sourced from
  the local `.env` file (which Docker Compose reads automatically). This
  keeps docker-compose.yml itself credential-free and safe to commit, even
  though the values are only throwaway local-dev ones.
- kafka — single broker, KRaft mode (no separate Zookeeper container)
- redis — exposed on default port
- elasticsearch — single node, security disabled for local dev only

## Prisma integration via Skills

- Prisma is integrated using Prisma's official skills package (`prisma/skills`,
  installable via `npx add-skill`), rather than the MCP server originally
  planned — Prisma's current MCP server (v7/v8) is remote-only and scoped
  to managing Prisma's own hosted database product (Prisma Postgres), which
  doesn't apply to this project's self-hosted Postgres container. Skills
  give the agent structured, accurate reference material for Prisma CLI
  and Client usage without that mismatch.
- Workflow: the agent states which specific skill(s) it needs (e.g.
  `prisma-cli`, `prisma-client-api`, `prisma-database-setup`) and why. The
  human installs/adds them. Once the human confirms the skills are added,
  the agent resumes and completes Prisma setup — connecting to Postgres via
  the CLI directly (`prisma migrate dev`, `prisma generate`, etc.), informed
  by the installed skills.
- This is a hard pause point, per ai-workflow-rules.md: the agent does not
  add skills itself, and does not work around the wait by proceeding with
  raw CLI usage uninformed by the skill before the human confirms it's
  ready.
- The result of this setup is a `PrismaModule` exposing a `PrismaService`
  (wrapping `PrismaClient`, connection lifecycle only) — this is the only
  way any business module touches Postgres, per architecture-context.md.
- Actual schema modeling (User, Post, Follow) still happens in spec 02 —
  this spec only confirms Prisma can connect via the CLI, informed by the
  installed skills.

## Module skeleton

Per architecture-context.md boundaries, under src/:

- users/ (module, controller, service — empty for now)
- follows/ (module, controller, service — empty for now)
- posts/ (module, controller, service — empty for now)
- feed/ (module, controller, service — empty for now)
- search/ (module, controller, service — empty for now)
- common/ (guards, interceptors, rate-limiter — empty for now)
- prisma/ (module, PrismaService — connection lifecycle only)
- kafka/ (module — producer/consumer client wiring, empty logic for now)
- redis/ (module — client + generic sorted-set helpers, empty for now)
- elasticsearch/ (module — client + generic index/search helpers, empty for now)
- app.module.ts
- main.ts

Each module is registered in app.module.ts even though it has no logic yet —
this locks the boundary in from the start rather than merging modules later
"temporarily."

## Environment variables

Defined in .env.example (committed, placeholder values only) and .env
(gitignored, real local values):

- DATABASE_URL
- POSTGRES_USER
- POSTGRES_PASSWORD
- POSTGRES_DB
- KAFKA_BROKER
- KAFKA_NODE_ID
- KAFKA_PROCESS_ROLES
- KAFKA_LISTENERS
- KAFKA_ADVERTISED_LISTENERS
- KAFKA_CONTROLLER_LISTENER_NAMES
- KAFKA_LISTENER_SECURITY_PROTOCOL_MAP
- KAFKA_CONTROLLER_QUORUM_VOTERS
- KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR
- REDIS_URL
- ELASTICSEARCH_URL
- PORT

`.env.example`'s values can be realistic-looking local ones (not abstract
placeholders like `<user>`) since none of them are real secrets — they're
local-only Docker Compose credentials that must also match
docker-compose.yml's variable substitution to work at all.

## .env handling — who creates it (important, avoids ambiguity)

`.env.example` is created and committed by the agent, with placeholder
values only. **`.env` itself is created by the human, not the agent** — the
human copies `.env.example` to `.env` and fills in real local values
themselves. Per ai-workflow-rules.md, the agent must never read, write,
modify, delete, or print (cat) `.env`, under any circumstance, for the
entire lifetime of this project — this rule overrides any other reading of
this spec's intent. If the agent needs to verify something that would
normally require `.env` values (e.g. testing a connection), it does so by
asking the human to confirm `.env` is in place, or by using inline
shell-level environment variables for its own verification steps — never by
touching the file directly.

## Acceptance criteria

- docker-compose up brings up Postgres, Kafka (KRaft mode), Redis, and
  Elasticsearch with no errors
- NestJS app boots successfully and connects to all four services on
  startup via their respective infrastructure modules. A successful
  connection is defined per service as: Kafka — producer connects without
  error (kafkajs has no separate ping primitive); Redis — `ioredis`'s
  `.connect()` resolves; Elasticsearch — `client.ping()` succeeds. Each
  logs a clear success line on boot.
- Prisma is connected to Postgres via the CLI, informed by the installed
  Prisma skills, confirmed working through PrismaService
- All 10 module skeletons exist and are registered, with no cross-module
  imports beyond what's needed for wiring
- `.env.example` is committed with placeholder values; `.env` is gitignored,
  created by the human (not the agent), and never touched by the agent at
  any point
- No Prisma models, no Kafka topics, no Redis keys, no ES indices yet —
  connections only
- No validation libraries (`class-validator`/`class-transformer`) installed
  — out of scope until the first DTO exists (spec 02)

## Notes

This is the only feature spec that's purely infrastructure — every spec
after this one builds actual behavior on top of what's set up here.

## Current status / next step

Spec locked (patched: replaced Prisma MCP server integration with Prisma
Skills, since Prisma's current MCP server is remote-only and scoped to
Prisma Postgres, not applicable to our self-hosted database).
