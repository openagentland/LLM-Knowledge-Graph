---
name: lkg-slice
description: Return a bounded evidence slice around a criterion anchor.
---

# lkg-slice

## Purpose

Return a bounded evidence slice around a criterion anchor.

## Inputs

- `criterion` (required)
- `direction`: `forward | backward | both` (optional)
- `include[]`: `calls | control | data | imports | config` (optional)
- `max_evidence` (optional)
- `max_files` (optional)
- `max_nodes` (optional)

## Invocation behavior

- When `criterion` is provided, immediately call `lkg.slice(criterion, direction, include, max_evidence, max_files, max_nodes)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.slice(criterion, direction, include, max_evidence, max_files, max_nodes)`.
2. If the tool succeeds, return the slice, items, relation paths, evidence, limitations, and provenance fields provided by the tool.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Evidence slice`.
2. Then report the exact input values that were provided.
3. Include the returned top-level fields when present:
   - `slice_id`
   - `completeness`
4. Then write `Items (<count>)`.
5. For each item, include:
   - ordinal number
   - `anchor`
   - `confidence`
   - `precision_tier`
   - `inclusion_reason`
   - `Relation path segments: <count>`
   - evidence locations and provenance
6. If `limitations` is present, include a `Limitations` section and report each item as returned.
7. Do not replace the bounded slice with a synthesized narrative summary.

## Outputs

- `slice_id`
- `completeness`
- `criterion`
- `items[]`
- `limitations` (if present)

## Failure policy

- If `lkg.slice` returns an error, surface that error as-is.

## Guardrails

- Treat results as a bounded evidence slice.
- Do not imply stronger certainty than the returned `confidence` or `precision_tier` supports.
- Never drop evidence, relation path, or provenance metadata.
- Do not synthesize broader flow or architecture conclusions beyond the tool output.

## Example use

- Retrieve a bounded evidence set around a symbol, file, module, package, or entrypoint anchor.
