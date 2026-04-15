---
name: index-verify
description: Run index lifecycle in a selected mode and verify health/freshness after execution.
---

# index-verify

## Purpose

Execute `lkg.index` safely and confirm post-run system state.

## Inputs

- `mode`: `full | incremental | rebuild`
- `force` (optional, default: `false`)

## Steps

1. Call `lkg.status` (pre-check).
2. If `index_state=running`, stop with `ALREADY_RUNNING`.
3. If `needs_reindex=false` and `force=false`, return no-op.
4. Otherwise call `lkg.index(mode)`.
5. Call `lkg.status` again for post-run verification.

## Outputs

- `decision`: `no_op | indexed | already_running | blocked`
- `mode_used`
- `pre_status`, `post_status`
- `needs_reindex`
- `next_action`

## Failure policy

- If MCP tools return taxonomy errors (`ALREADY_RUNNING`, `INTERNAL_ERROR`, etc.), surface them and stop.

## Guardrails

- Do not retry in unbounded loops.
- Do not mutate runtime ENV/config.
- Do not bypass MCP contracts.

## Example use

- Run after `status-decision` indicates stale knowledge.
