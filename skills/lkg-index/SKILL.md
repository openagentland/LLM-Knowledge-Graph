---
name: lkg-index
description: Start an index lifecycle run for the active project scope.
---

# lkg-index

## Purpose

Start an LKG index lifecycle run for the active project scope.

## Inputs

- `mode`: `full | incremental | rebuild` (optional, defaults to `incremental`)

## Invocation behavior

- If `mode` is not provided, default to `incremental`.
- On invocation, do not ask generic repository questions when `mode` is already provided or defaulted.
- Immediately call `lkg.index(mode)`.
- Do not ask follow-up questions before calling the tool.
- Do not add your own preflight workflow unless the user explicitly asks for one.

## Steps

1. Resolve `mode`:
   - use the provided `mode` when present
   - otherwise use `incremental`
2. Call `lkg.index(mode)`.
3. If the tool succeeds, return the accepted run metadata directly.
4. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Index run accepted` when the tool succeeds.
2. Then report the returned fields that are present:
   - `state`
   - `mode`
   - `indexRunId`
   - `acceptedAt`
3. Preserve field names exactly as returned by the tool.
4. Do not claim completion if the tool only reports acceptance.
5. If `mode` was defaulted, state `mode: incremental` without framing it as a question.

## Outputs

- `acceptedAt`
- `indexRunId`
- `mode`
- `state`

## Failure policy

- If `lkg.index` returns an error, surface that error as-is.

## Guardrails

- Do not preflight with your own decision taxonomy unless the user explicitly asks for that workflow.
- Do not retry in loops.
- Do not mutate runtime configuration or bypass MCP contracts.

## Example use

- Start an incremental or rebuild indexing run for the current project scope.
