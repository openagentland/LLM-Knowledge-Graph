---
name: lkg-status
description: Inspect the current index lifecycle state for the active project scope.
---

# lkg-status

## Purpose

Inspect the current LKG index lifecycle state for the active project scope.

## Inputs

- None.

## Invocation behavior

- On invocation, do not ask the user what they want to do with the repo.
- Immediately call `lkg.status`.
- Do not ask follow-up questions before calling the tool.
- Do not switch into a generic repository-assistant response.

## Steps

1. Call `lkg.status`.
2. If the tool succeeds, return the reported lifecycle fields directly.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `LKG status`.
2. Then report the returned fields that are present:
   - `state`
   - `needsReindex`
   - `lastIndexedAt`
   - `indexRunId`
   - `indexScope`
   - `activeProjectIdentity`
   - `watcherState`
   - `daemonState` (if present)
   - `runtimeState` (if present)
   - `pendingChanges`
   - `counters`
   - `lastError`
3. Preserve field names exactly as returned by the tool.
4. Do not invent extra status labels, readiness tiers, or recommendations unless the user explicitly asks for interpretation.

## Outputs

- `activeProjectIdentity`
- `counters`
- `daemonState` (if present)
- `indexRunId`
- `indexScope`
- `lastError`
- `lastIndexedAt`
- `needsReindex`
- `pendingChanges`
- `runtimeState` (if present)
- `state`
- `watcherState`

## Failure policy

- If `lkg.status` returns an error, surface that error as-is.

## Guardrails

- Do not trigger `lkg.index` automatically.
- Do not infer readiness states that are not present in the tool output.
- Do not synthesize conclusions beyond the reported status fields.

## Example use

- Inspect whether the active project scope is indexed, stale, or currently running.
