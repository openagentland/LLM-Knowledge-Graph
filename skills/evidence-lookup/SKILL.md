---
name: evidence-lookup
description: Retrieve normalized evidence with lkg.search while preserving location and provenance.
---

# evidence-lookup

## Purpose

Standardize evidence retrieval for implementation and documentation questions.

## Inputs

- `query` (required)
- `top_k` (optional)
- `warn_if_stale` (optional, default: `true`)

## Steps

1. If `warn_if_stale=true`, call `lkg.status` and inspect `needs_reindex`.
2. Call `lkg.search(query, top_k)`.
3. Return `results[]` in a stable format while preserving provenance.

## Outputs

- `query`
- `freshness_warning` (nullable)
- `results[]` with:
  - `evidence_id`, `path`, `source_type`, `snippet`
  - `start_line/end_line` (code)
  - `section` or `offset` (doc)
  - `provenance` (`index_run_id`, `extractor`, `content_hash`)

## Failure policy

- If no results are found, return `no evidence found` and suggest query refinement.

## Guardrails

- Do not replace evidence with synthesized answers.
- Never drop location/provenance metadata during formatting.

## Example use

- Find MCP server entry points, search contract locations, and default config behavior.
