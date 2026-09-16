# CLAUDE.md

This file is the entry point for any AI agent (Claude Code) working in this
repository. Read this first, every session.

## What this project is

A backend-only feed fan-out system (Twitter/Instagram-style). Full details
are in `context/project-overview.md` — read it before doing anything else.

## Before writing any code, always read (in order)

1. `context/project-overview.md`
2. `context/architecture-context.md`
3. `context/code-standards.md`
4. `context/ai-workflow-rules.md`
5. The specific feature spec in `feature-specs/` for whatever is being built

Do not infer scope, architecture, or conventions from this file alone — it
is a pointer, not a substitute for the files above.

## Hard rules (non-negotiable, apply for the lifetime of this repo)

- **Never read, write, modify, delete, or print/cat the `.env` file**,
  under any circumstance, for any reason. Only `.env.example` is touched.
  Full detail: `context/ai-workflow-rules.md`.
- **Never install or authorize an MCP server or external tool.** State what
  is needed and wait for the human to install and authorize it. No CLI
  fallback workarounds. Full detail: `context/ai-workflow-rules.md`.
- **Never do git commit and git push**

## Where things live

- `context/` — durable project-level decisions (architecture, conventions,
  workflow rules, progress tracking)
- `feature-specs/` — one file per implementation unit, numbered in build
  order; each maps to a locked scope, not to be expanded without flagging it
- `context/progress-tracker.md` — current build status; check this to see
  what's already done before assuming a feature doesn't exist yet

## Scope discipline

This project has a locked MVP scope (9 items, see `project-overview.md`)
and an explicit "Future scope" list of things intentionally not being
built. Do not pull in anything from that list without being asked. If a
spec seems to require something outside locked scope, stop and flag it
rather than deciding silently.
