---
name: LKG Explorer
description: Retrieve evidence and candidate-first symbol information using the current LKG MCP retrieval tools.
---

# LKG Explorer

## Purpose

Retrieve grounded project information from the current LKG retrieval surface: evidence search, candidate-first symbol discovery and detail, entrypoint discovery, bounded flow tracing, bounded impact analysis, and bounded slicing.

## Inputs

- `query`: string (optional, used with `lkg.search`, `lkg.symbols`, or `lkg.entrypoints`)
- `top_k`: number (optional)
- `path`: string (optional)
- `package`: string (optional)
- `limit`: number (optional)
- `kind`: string (optional)
- `source_type`: `code | doc` (optional)
- `symbol`: string (optional)
- `warn_if_stale`: boolean (optional, default: `true`)
- `confidence_min`: number (optional)
- `from`: anchor (optional)
- `to`: anchor (optional)
- `target`: anchor (optional)
- `criterion`: anchor (optional)
- `direction`: `forward | backward | both` (optional)
- `include`: array (optional)
- `max_depth`: number (optional)
- `max_nodes`: number (optional)
- `time_budget_ms`: number (optional)
- `max_results`: number (optional)
- `max_evidence`: number (optional)
- `max_files`: number (optional)

## Tool usage

- Primary retrieval: `lkg.search`
- Optional symbol discovery: `lkg.symbols`
- Optional symbol detail: `lkg.symbol`
- Optional entrypoint discovery: `lkg.entrypoints`
- Optional bounded tracing: `lkg.flow`
- Optional bounded impact analysis: `lkg.impact`
- Optional bounded slicing: `lkg.slice`
- Optional freshness check: `lkg.status`

## Workflow

1. If `warn_if_stale=true`, optionally call `lkg.status` and inspect `needsReindex` before retrieval.
2. Choose the MCP tool that fits the provided inputs:
   - Use `lkg.search(query, top_k)` for broad evidence retrieval.
   - Use `lkg.symbols(kind, path, query, source_type)` when the goal is to discover candidate symbols.
   - Use `lkg.symbol(path, symbol)` when both `path` and `symbol` are provided and the goal is a specific symbol detail lookup.
   - Use `lkg.entrypoints(query, path, package, kind, confidence_min, limit)` when the goal is to discover project starting surfaces.
   - Use `lkg.flow(from, to, direction, include, confidence_min, max_depth, max_nodes, time_budget_ms)` when the goal is bounded trace retrieval.
   - Use `lkg.impact(target, mode, confidence_min, max_depth, max_results)` when the goal is bounded blast-radius analysis.
   - Use `lkg.slice(criterion, direction, include, max_evidence, max_files, max_nodes)` when the goal is a bounded evidence slice around an anchor.
3. Prefer candidate-first symbol lookup:
   - If symbol identity is ambiguous, use `lkg.symbols` before `lkg.symbol`.
4. Return the tool output in a structured way while preserving path, location, source type, confidence, precision, limitations, and provenance fields.
5. If the MCP tool reports an error such as `INDEX_NOT_READY`, surface it as-is.

## Output contract

- `toolUsed`: `lkg.search | lkg.symbols | lkg.symbol | lkg.entrypoints | lkg.flow | lkg.impact | lkg.slice`
- `freshnessWarning`: string | null
- For `lkg.search`:
  - `query`
  - `results[]`
    - `evidence_id`
    - `path`
    - `source_type`
    - `snippet`
    - `start_line`, `end_line` (for code)
    - `section` or `offset` (for doc)
    - `provenance` (`index_run_id`, `extractor`, `content_hash`)
- For `lkg.symbols`:
  - `filters`
  - `results[]`
    - `name`
    - `kind`
    - `language`
    - `scope`
    - `source_type`
    - `container_name` (if present)
    - `signature` (if present)
    - `index_run_id`
    - `evidence`
      - `path`
      - `code_location.start_line`
      - `code_location.end_line`
      - `evidence_id`
      - `extractor`
      - `content_hash`
- For `lkg.symbol`:
  - `path`
  - `symbol`
  - `candidates[]`
    - `name`
    - `kind`
    - `language`
    - `scope`
    - `source_type`
    - `container_name` (if present)
    - `signature` (if present)
    - `index_run_id`
    - `evidence`
      - `path`
      - `code_location.start_line`
      - `code_location.end_line`
      - `evidence_id`
      - `extractor`
      - `content_hash`
- For `lkg.entrypoints`:
  - `results[]`
    - `entrypoint_id`
    - `name`
    - `kind`
    - `path`
    - `start_line`, `end_line` (if present)
    - `confidence`
    - `precision_tier`
    - `detection_reason`
    - `command` (if present)
    - `trigger` (if present)
    - `symbol_id` (if present)
    - `evidence[]`
  - `limitations` (if present)
- For `lkg.flow`:
  - `traces[]`
    - `trace_id`
    - `start`
    - `end` (if present)
    - `completeness`
    - `confidence`
    - `precision_tier`
    - `segments[]`
  - `limitations` (if present)
- For `lkg.impact`:
  - `target`
  - `summary`
    - `direct_count`
    - `transitive_count`
    - `possible_count`
    - `truncated`
  - `impacts[]`
  - `limitations` (if present)
- For `lkg.slice`:
  - `slice_id`
  - `criterion`
  - `completeness`
  - `items[]`
  - `limitations` (if present)

## Guardrails

- Treat symbol outputs as candidate-first, not guaranteed unique resolution.
- Treat entrypoint, flow, impact, and slice outputs as bounded, evidence-first, and confidence-aware.
- Do not synthesize conclusions beyond the returned evidence or metadata.
- Do not imply stronger certainty than the returned `confidence` or `precision_tier` supports.
- Do not imply raw graph traversal, architecture synthesis, or other capabilities that are not implemented as public MCP tools.
- Never drop path, line/section, source type, limitations, or provenance metadata.
- Do not trigger `lkg.index` from this agent.
