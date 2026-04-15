---
name: lkg-evidence-search
description: Evidence-first retrieval helper using lkg.search with stable location and provenance output.
---

# lkg-evidence-search

## Purpose

Standardize recurring evidence lookups and return source-locatable results.

## Inputs

- `query`: string (required)
- `top_k`: number (optional)
- `warn_if_stale`: boolean (default: `true`)

## Tool usage

- Primary: `lkg.search`
- Optional pre-check: `lkg.status`

## Workflow

1. If `warn_if_stale=true`, call `lkg.status` and inspect `needs_reindex`.
2. Call `lkg.search(query, top_k)`.
3. Normalize output ordering while preserving evidence metadata.
4. Return results plus optional freshness warning.

## Output contract

- `query`: string
- `freshness_warning`: string | null
- `results[]`:
  - `evidence_id`
  - `path`
  - `source_type` (`code | doc`)
  - `snippet`
  - `start_line`, `end_line` (for `code`)
  - `section` or `offset` (for `doc`)
  - `provenance` (`index_run_id`, `extractor`, `content_hash`)

## Guardrails

- Do not replace evidence with synthesized conclusions.
- If empty results: return `no evidence found` and suggest query refinement.
- Never drop provenance/location metadata during formatting.
