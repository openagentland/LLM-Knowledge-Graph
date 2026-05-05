---
name: lkg-impact
description: Analyze bounded evidence-backed impact from a target anchor.
---

# lkg-impact

## Purpose

Analyze bounded evidence-backed impact from a target anchor.

## Inputs

- `target` (required)
- `mode`: `callers | callees | dependents | tests | runtime | all` (optional)
- `confidence_min` (optional)
- `max_depth` (optional)
- `max_results` (optional)

## Invocation behavior

- When `target` is provided, immediately call `lkg.impact(target, mode, confidence_min, max_depth, max_results)`.
- Do not ask generic repository questions before calling the tool.
- Do not switch into generic chat mode.

## Steps

1. Call `lkg.impact(target, mode, confidence_min, max_depth, max_results)`.
2. If the tool succeeds, return the impact list, summary, reasons, paths, evidence, limitations, and provenance fields provided by the tool.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Impact analysis`.
2. Then report the exact input values that were provided.
3. Include `Summary` with:
   - `direct_count`
   - `transitive_count`
   - `possible_count`
   - `truncated`
4. Then write `Impacts (<count>)`.
5. For each impact, include:
   - ordinal number
   - `anchor`
   - `kind`
   - `classification`
   - `confidence`
   - `precision_tier`
   - `Paths: <count>`
   - `Reasons: <count>`
   - evidence locations and provenance
6. If `limitations` is present, include a `Limitations` section and report each item as returned.
7. Do not replace the returned classifications, reasons, or paths with your own ranking logic.

## Outputs

- `target`
- `summary`
  - `direct_count`
  - `transitive_count`
  - `possible_count`
  - `truncated`
- `impacts[]`
- `limitations` (if present)

## Failure policy

- If `lkg.impact` returns an error, surface that error as-is.

## Guardrails

- Treat results as bounded impact analysis, not exhaustive certainty.
- Do not imply stronger certainty than the returned `confidence` or `precision_tier` supports.
- Never drop evidence, paths, reasons, or provenance metadata.
- Do not synthesize broader architecture conclusions beyond the tool output.

## Example use

- Estimate blast radius for changing a symbol, file, module, package, workflow, or entrypoint.
