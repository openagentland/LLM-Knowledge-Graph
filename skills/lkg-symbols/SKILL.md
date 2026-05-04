---
name: lkg-symbols
description: List symbol candidates by path, kind, source type, or text query with provenance-rich evidence.
---

# lkg-symbols

## Purpose

List symbol candidates using the currently implemented filters and evidence shape.

## Inputs

- `kind` (optional)
- `path` (optional)
- `query` (optional)
- `source_type`: `code | doc` (optional)

## Invocation behavior

- If the needed inputs are already provided, immediately call `lkg.symbols(kind, path, query, source_type)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.symbols(kind, path, query, source_type)`.
2. If the tool succeeds, return the candidate list with the evidence and provenance fields provided by the tool.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Symbol candidates`.
2. If any filters were provided, list them on separate lines using the exact input field names.
3. Then write `Matches (<count>)`.
4. For each result, include:
   - ordinal number
   - `name`
   - `kind`
   - `path` with `start_line-end_line` when available in `evidence.code_location`
   - `language`
   - `scope`
   - `source_type`
   - `container_name` if present
   - `signature` if present
   - `Provenance: index_run_id=<...>, extractor=<...>, content_hash=<...>`
5. Treat results as candidates, not guaranteed unique resolutions.

## Outputs

- `results[]` with:
  - `container_name` (if present)
  - `evidence`
    - `code_location`
      - `start_line`
      - `end_line`
    - `content_hash`
    - `evidence_id`
    - `extractor`
    - `path`
  - `index_run_id`
  - `kind`
  - `language`
  - `name`
  - `scope`
  - `signature` (if present)
  - `source_type`

## Failure policy

- If `lkg.symbols` returns an error, surface that error as-is.

## Guardrails

- Treat results as candidate-first symbol listings.
- Do not imply guaranteed uniqueness or deeper semantic resolution than the tool returns.
- Do not infer graph, impact, or flow semantics from this tool alone.

## Example use

- Narrow symbol candidates in a file or by kind before opening source.
