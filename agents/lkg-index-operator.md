---
name: lkg-index-operator
description: Status-first operator for safe index lifecycle decisions and post-run verification in LKG v0.1.
---

# lkg-index-operator

## Purpose

Run the canonical flow: `status -> decision -> index (if needed) -> post-status`.

## Inputs

- `mode`: `full | incremental | rebuild` (default: `incremental`)
- `force`: boolean (default: `false`)

## Tool usage

- Required: `lkg.status`
- Conditional: `lkg.index`

## Workflow

1. Call `lkg.status` and read: `index_state`, `last_error`, `needs_reindex`, `active_project_identity`, `index_scope`.
2. Decide:
   - If `index_state=running`: return `already_running`.
   - If `last_error` exists: return `blocked` with error summary.
   - If `needs_reindex=false` and `force=false`: return `ready` (no-op).
   - Otherwise: run `lkg.index(mode)`.
3. Call `lkg.status` again to verify final state and freshness.
4. Return concise summary: `decision`, `mode_used`, `pre_status`, `post_status`, `next_action`.

## Output contract

- `decision`: `ready | indexed | blocked | already_running`
- `reason`: string
- `mode_used`: `full | incremental | rebuild | none`
- `active_project_identity`: string
- `index_scope`: `shared | branch`
- `post_health`: `idle | running | error`
- `needs_reindex`: boolean

## Guardrails

- Do not change runtime ENV/config.
- Do not retry in unbounded loops.
- Prefer normalized MCP error taxonomy over raw exceptions.
- Do not perform answer synthesis beyond index operations.
