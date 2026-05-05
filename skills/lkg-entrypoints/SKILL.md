---
name: lkg-entrypoints
description: List evidence-backed entrypoint candidates for the active project scope.
---

# lkg-entrypoints

## Purpose

List evidence-backed entrypoint candidates for the active project scope.

## Inputs

- `query` (optional)
- `path` (optional)
- `package` (optional)
- `kind`: `mcp_tool | cli | script | http | worker | test | library_export | workflow | entrypoint` (optional)
- `confidence_min` (optional)
- `limit` (optional)

## Invocation behavior

- If the needed inputs are already provided, immediately call `lkg.entrypoints(query, path, package, kind, confidence_min, limit)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.entrypoints(query, path, package, kind, confidence_min, limit)`.
2. If the tool succeeds, return the candidate list with the evidence, confidence, precision, and provenance fields provided by the tool.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Entrypoint candidates`.
2. If any filters were provided, list them on separate lines using the exact input field names.
3. Then write `Matches (<count>)`.
4. For each result, include:
   - ordinal number
   - `name`
   - `kind`
   - `path` with `start_line-end_line` when available
   - `confidence`
   - `precision_tier`
   - `detection_reason`
   - `command` if present
   - `trigger` if present
   - `symbol_id` if present
   - evidence locations and provenance
5. If `limitations` is present, include a `Limitations` section and report each item as returned.
6. Treat results as evidence-backed candidates, not guaranteed exhaustive or certain entrypoint resolution.

## Outputs

- `results[]` with:
  - `command` (if present)
  - `confidence`
  - `detection_reason`
  - `end_line` (if present)
  - `entrypoint_id`
  - `evidence[]`
  - `kind`
  - `name`
  - `path`
  - `precision_tier`
  - `start_line` (if present)
  - `symbol_id` (if present)
  - `trigger` (if present)
- `limitations` (if present)

## Failure policy

- If `lkg.entrypoints` returns an error, surface that error as-is.

## Guardrails

- Treat results as evidence-backed candidates.
- Do not imply stronger certainty than the returned `confidence` or `precision_tier` supports.
- Never drop evidence location or provenance metadata.
- Do not synthesize system behavior beyond the tool output.

## Example use

- Find likely project starting surfaces such as MCP tools, CLI commands, scripts, workflows, or HTTP entrypoints.
