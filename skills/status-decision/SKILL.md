---
name: status-decision
description: Read LKG status and return the next action decision based on the v0.1 trust gate.
---

# status-decision

## Purpose

Assess whether LKG state is trustworthy before running search or index workflows.

## Inputs

- `strict` (optional, default: `false`)

## Steps

1. Call `lkg.status`.
2. Evaluate:
   - `index_state=error` or `last_error` exists -> `blocked`.
   - `needs_reindex=true` -> `needs_reindex`.
   - otherwise -> `ready`.
3. Return decision and recommended next action.

## Outputs

- `decision`: `ready | needs_reindex | blocked`
- `reason`: string
- `recommended_next_action`: `run_incremental | run_rebuild | proceed_search | inspect_error`
- `active_project_identity`, `index_scope`

## Failure policy

- If `lkg.status` fails, return `blocked` with normalized error context.

## Guardrails

- Do not trigger `lkg.index` automatically.
- Do not synthesize conclusions outside the trust-gate scope.

## Example use

- Run at the start of a new session before search or indexing.
