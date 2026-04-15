# Agents

This directory contains reusable custom agents for LKG v0.1 operational workflows.

## Available agents

- `lkg-index-operator.md` — status-first index lifecycle operator.
- `lkg-evidence-search.md` — evidence-first retrieval helper for recurring technical questions.

## Rules

- Agents orchestrate existing MCP tools only: `lkg.status`, `lkg.index`, `lkg.search`.
- Agents must not contain indexing/retrieval/ranking business logic.
- Do not bypass MCP contracts or expose provider-specific internals in agent output.
- If a capability is missing, implement it in code first, then update agent docs.
