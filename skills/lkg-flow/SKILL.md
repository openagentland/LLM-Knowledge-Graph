---
name: lkg-flow
description: Trace bounded evidence-backed flow segments from an anchor.
---

# lkg-flow

## Purpose

Trace bounded evidence-backed flow segments from an anchor.

## Inputs

- `from` (optional)
- `to` (optional)
- `direction`: `forward | backward | both` (optional)
- `include[]`: `calls | imports | exports | control | data | config | workflow` (optional)
- `confidence_min` (optional)
- `max_depth` (optional)
- `max_nodes` (optional)
- `time_budget_ms` (optional)

## Invocation behavior

- If the needed inputs are already provided, immediately call `lkg.flow(from, to, direction, include, confidence_min, max_depth, max_nodes, time_budget_ms)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.flow(from, to, direction, include, confidence_min, max_depth, max_nodes, time_budget_ms)`.
2. If the tool succeeds, return the traces while preserving anchors, segments, evidence, limitations, and provenance.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Flow traces`.
2. If any inputs were provided, list them using the exact input field names.
3. Then write `Traces (<count>)`.
4. For each trace, include:
   - ordinal number
   - `trace_id`
   - `start`
   - `end` if present
   - `completeness`
   - `confidence`
   - `precision_tier`
   - `Segments: <count>`
5. For each segment, include:
   - ordinal number
   - `from`
   - `relation_kind`
   - `to`
   - `confidence`
   - `precision_tier`
   - evidence locations and provenance
6. If `limitations` is present, include a `Limitations` section and report each item as returned.
7. Do not replace bounded traces with synthesized explanations.

## Outputs

- `traces[]` with:
  - `completeness`
  - `confidence`
  - `end` (if present)
  - `precision_tier`
  - `segments[]`
  - `start`
  - `trace_id`
- `limitations` (if present)

## Failure policy

- If `lkg.flow` returns an error, surface that error as-is.

## Guardrails

- Treat results as bounded evidence-backed traces.
- Do not imply stronger certainty than the returned `confidence` or `precision_tier` supports.
- Never drop anchor, evidence, or provenance metadata.
- Do not turn the trace output into unsupported architectural or runtime conclusions.

## Example use

- Trace calls, control, data, config, or workflow relations from one anchor to another.
