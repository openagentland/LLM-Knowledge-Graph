# Skills

This directory contains reusable custom skills for recurring LKG v0.1 workflows.

## Available skills

- `status-decision/SKILL.md` — evaluate `lkg.status` and decide next action.
- `index-verify/SKILL.md` — run `lkg.index` in a selected mode and verify post-run state.
- `evidence-lookup/SKILL.md` — retrieve evidence with `lkg.search` using a stable output shape.

## Rules

- Skills orchestrate existing MCP tools only.
- Do not add business logic beyond `lkg.status`, `lkg.index`, `lkg.search` contracts.
- Skill content must reflect implemented behavior, not aspirational capabilities.
