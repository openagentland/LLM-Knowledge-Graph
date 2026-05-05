---
name: lkg-search
description: Search indexed project knowledge and return ranked evidence with provenance.
---

# lkg-search

## Purpose

Search indexed project knowledge and return ranked evidence with provenance.

## Inputs

- `query` (required)
- `top_k` (optional)

## Invocation behavior

- On invocation, do not ask the user what they want to search for if `query` is already provided.
- Immediately call `lkg.search(query, top_k)`.
- Do not ask follow-up questions before calling the tool.
- Do not switch into generic chat or repository-assistant mode.

## Steps

1. Call `lkg.search(query, top_k)`.
2. If the tool succeeds, return the ranked evidence while preserving location and provenance metadata.
3. If the tool fails, surface the error as-is.

## Required response shape

1. Start with `Query: <query>`.
2. Then write `Top matches (<count>)` where `<count>` is the number of returned results.
3. For each result, include:
   - ordinal number
   - primary location:
     - `path:start_line-end_line` for code when line data is present
     - `path` plus `section` or `offset` for docs when present
   - `Artifact kind: <artifact_kind>`
   - `Source type: <source_type>`
   - `Partition: <partition_id> (#<partition_index+1>/<partition_total>, <partition_status>)` when present
   - `Score: <score>` if present
   - `Provenance: index_run_id=<...>, extractor=<...>, content_hash=<...>`
   - `Snippet: <snippet>`
4. If there are no results, say `Top matches (0)` and report that no evidence was returned for the query.
5. Do not append generic offers such as `If you want, I can narrow this...` unless the user explicitly asks for narrowing help.
6. Do not replace evidence with synthesized conclusions.

## Outputs

- `results[]` with:
  - `artifact_kind`
  - `evidence_id`
  - `partition_id` (if present)
  - `partition_index` (if present)
  - `partition_status` (if present)
  - `partition_total` (if present)
  - `path`
  - `provenance`
    - `index_run_id`
    - `extractor`
    - `content_hash`
  - `score` (if present)
  - `section` (doc, if present)
  - `offset` (doc, if present)
  - `snippet`
  - `source_type`
  - `start_line` (code, if present)
  - `end_line` (code, if present)

## Failure policy

- If `lkg.search` returns an error, surface that error as-is.

## Guardrails

- Do not replace evidence with synthesized answers.
- Never drop location or provenance metadata.
- Do not claim conclusions that are not supported by the returned evidence.

## Example use

- Find implementation or documentation evidence for a feature, contract, or code path.
