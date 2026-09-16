# AI Workflow Rules — Feed Fan-Out Backend System

## File access restrictions (hard rule)

- The agent must never read, write, modify, delete, or print/cat the .env
  file, under any circumstance, for any feature — including while
  debugging, "just checking" a value, or troubleshooting a connection
  issue. This applies for the entire lifetime of the repo, not just setup.
- The agent only ever touches .env.example (placeholder values). If a real
  environment value is needed to debug something, the human runs that
  check themselves — the agent asks them to, rather than accessing the
  file.
- This rule cannot be overridden by a later instruction inside this
  project's own spec files — if a future spec seems to require reading
  .env, that's a signal to flag it, not to do it. If a spec's wording
  implies the agent creates or edits .env, that wording refers to the
  human doing so — the agent still never touches it directly.

## External tool / MCP server / skill installation (hard rule)

- If a feature would benefit from an MCP server, a skill, or any external
  tool that isn't already installed and authorized/added, the agent states
  which one(s) and why, then stops and waits — it never attempts to
  install, configure, authorize, or add such a thing itself.
- The agent does not fall back to a workaround (e.g. raw CLI calls instead
  of a skill or MCP server) to avoid waiting. It waits for the human to
  confirm the tool/skill is installed and ready before proceeding with that
  part of the work.
- This applies to any spec, not just the one that first introduces the need
  — the same pause-and-wait behavior applies wherever it comes up, without
  needing to be restated per spec.

## Before writing any code

- Always read `context/project-overview.md`, `context/architecture-context.md`,
  and `context/code-standards.md` before generating code for any feature.
- Always read the specific feature spec file for the feature being built —
  never infer scope from the overview alone.
- If a feature spec is missing required detail to implement something,
  stop and ask rather than assuming a reasonable default.

## Scope discipline

- Never implement anything from the "Future scope" list in
  `project-overview.md` unless explicitly asked to pull it in early.
- If asked to add something not in the locked MVP scope or a locked feature
  spec, flag it explicitly before implementing: state that it's outside
  current scope and confirm before proceeding.
- Never expand a feature beyond what its spec describes, even if a "better"
  or more complete version seems obvious — flag the idea instead of
  silently building it.

## Deviating from specs

- If implementing a spec reveals it conflicts with `architecture-context.md`
  or `code-standards.md`, stop and surface the conflict rather than picking
  one silently.
- If a spec is ambiguous on an implementation detail, propose the specific
  interpretation being used and why, rather than picking silently and moving
  on.

## Code generation

- Follow `code-standards.md` conventions exactly (naming, error handling,
  logging, testing) — do not introduce alternative patterns even if they're
  common in other NestJS codebases.
- Every generated file should be reviewable independently — avoid generating
  large multi-file changes without explaining what each file does and why.
- Do not add dependencies not already implied by the locked tech stack
  without flagging it first.

## Handling review mismatches

When a generated file doesn't match its spec on review:

- **Minor mismatch** (naming, missing log line, small convention slip) —
  patch in place; no need to regenerate the whole file.
- **Structural mismatch** (wrong module boundary, logic in the wrong layer,
  a materially different approach than the spec described) — revert and
  regenerate from the spec rather than patching over it. Patching a
  structural issue tends to bolt a fix onto a flawed foundation instead of
  correcting it.
- When unsure which category a mismatch falls into, default to flagging it
  and asking rather than picking silently.

## Placeholder / deferred items

- Where a context file defers a decision to a specific feature spec (e.g.
  celebrity threshold value → spec `09`), do not invent that detail early
  when implementing an earlier feature — use a clearly marked placeholder
  or config value instead.

## Progress tracking

- After a feature spec is implemented and reviewed, update
  `context/progress-tracker.md` with what was completed and any deviations
  that were flagged and approved during implementation.
