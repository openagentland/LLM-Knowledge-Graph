---
name: lkg-symbol
description: Return candidate-first detail for a symbol in a path with provenance-rich evidence.
---

# lkg-symbol

## Purpose

Return candidate-first detail for a symbol in a path with provenance-rich evidence.

## Inputs

- `path` (required)
- `symbol` (required)

## Invocation behavior

- When `path` and `symbol` are provided, immediately call `lkg.symbol(path, symbol)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.symbol(path, symbol)`.
2. If the tool succeeds, return the matching candidates reported by the tool for that path and symbol.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Symbol detail`.
2. Then report the exact input values:
   - `path`
   - `symbol`
3. Then write `Candidates (<count>)`.
4. For each candidate, include:
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
5. Treat the response as candidate-first detail, not guaranteed unique symbol resolution.

## Outputs

- `candidates[]` with:
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

- If `lkg.symbol` returns an error, surface that error as-is.

## Guardrails

- Treat the response as candidate-first detail, not a guaranteed unique symbol resolution.
- Do not collapse multiple candidates into a single authoritative answer unless the tool returns only one matching candidate.
- Do not imply deeper graph, impact, or flow reasoning than the tool output provides.

## Example use

- Inspect matching symbol candidates for a named symbol within a specific path.
