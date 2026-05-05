# Skills

This directory contains reusable custom skills that map 1:1 to the runtime LKG MCP tools.

## Available skills

- `lkg-status/SKILL.md` — inspect the current index lifecycle state for the active project scope.
- `lkg-index/SKILL.md` — start an index lifecycle run with a selected mode.
- `lkg-search/SKILL.md` — search indexed project knowledge and return ranked evidence with provenance.
- `lkg-symbols/SKILL.md` — list symbol candidates using the currently implemented filters and evidence shape.
- `lkg-symbol/SKILL.md` — return candidate-first symbol detail for a symbol in a path.
- `lkg-entrypoints/SKILL.md` — list evidence-backed entrypoint candidates for the active project scope.
- `lkg-flow/SKILL.md` — trace bounded evidence-backed flow segments from an anchor.
- `lkg-impact/SKILL.md` — analyze bounded evidence-backed impact from a target anchor.
- `lkg-slice/SKILL.md` — return a bounded evidence slice around a criterion anchor.

## Rules

- Skills are orchestration-only prompt surfaces over existing MCP tools.
- Skill names, folder names, and described tool intent must stay aligned 1:1.
- Do not add business logic, decision frameworks, or synthetic reasoning beyond the MCP contracts.
- Describe only implemented behavior that exists in code today.
- Preserve evidence and provenance; do not rewrite results into unsupported conclusions.
