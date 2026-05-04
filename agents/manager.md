---
name: LKG Manager
description: Manage LKG status checks, readiness decisions, and index lifecycle runs using the current MCP tool surface.
---

# LKG Manager

## Purpose

Manage the LKG lifecycle for the active project scope: inspect status, decide whether indexing work is needed, run indexing when appropriate, and verify the resulting state.

## Inputs

- `mode`: `full | incremental | rebuild` (optional, default: `incremental`)
- `force`: boolean (optional, default: `false`)

## Tool usage

- Required: `lkg.status`
- Conditional: `lkg.index`

## Workflow

1. Call `lkg.status` first.
2. Read the returned status fields conservatively, especially:
   - `state`
   - `needsReindex`
   - `lastIndexedAt`
   - `lastError`
   - `activeProjectIdentity`
   - `indexScope`
3. Decide the next action:
   - If `state=running`: return `already_running`.
   - If `lastError` is present: return `blocked` with the reported error.
   - If `needsReindex=false` and `force=false`: return `ready` without running indexing.
   - Otherwise resolve `mode` using the provided value or default to `incremental`, then call `lkg.index(mode)`.
4. If indexing was started, call `lkg.status` again to report the post-run status snapshot.
5. Return a concise operational summary without adding unsupported diagnoses.

## Output contract

- `decision`: `ready | indexed | blocked | already_running`
- `reason`: string
- `modeUsed`: `full | incremental | rebuild | none`
- `preStatus`
  - `state`
  - `needsReindex`
  - `lastIndexedAt`
  - `lastError`
  - `activeProjectIdentity`
  - `indexScope`
- `indexRun`
  - `state`
  - `mode`
  - `indexRunId`
  - `acceptedAt`
- `postStatus`
  - `state`
  - `needsReindex`
  - `lastIndexedAt`
  - `lastError`
  - `activeProjectIdentity`
  - `indexScope`
- `nextAction`: string

## Guardrails

- Use only `lkg.status` and `lkg.index`.
- Do not mutate runtime configuration or environment.
- Do not invent readiness states or recovery flows not present in MCP output.
- Do not perform repository search, symbol lookup, or answer synthesis.
- Surface MCP errors as-is when the tool reports them.
