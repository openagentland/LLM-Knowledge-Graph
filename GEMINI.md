## Early-Stage Agent Guidance

Before making implementation decisions, read these first:

1. `docs/vision.md`
2. `docs/developer-guide.md`

Treat them as the source of truth for direction and architecture boundaries.

## Execution Discipline

- State assumptions explicitly before implementing changes.
- If requirements are ambiguous, ask clarifying questions first.
- Prefer the simplest solution that satisfies the request.
- Make surgical changes only within the required scope.
- Do not add features, refactors, or configuration outside scope.
- Preserve existing code style and patterns.
- If you notice unrelated dead code, report it; do not remove it automatically.

## Verification-Driven Execution

- Define verifiable success criteria before implementation.
- For bug fixes: reproduce first, then verify the fix.
- For validation work: add or verify failing invalid-input cases first.
- For refactors: verify behavior remains unchanged.
- For multi-step tasks: include a verification method for each step.

## LKG v0.1 Operating Doctrine

Use this default workflow:

1. Check `lkg.status` to evaluate health and freshness.
2. If stale or missing, run `lkg.index` with the appropriate mode.
3. Use `lkg.search` to gather grounded evidence.
4. Read source files only after search narrows the scope.
5. Keep responses evidence-first with clear location/provenance.

## Boundary Rules

- `agents/` and `skills/` are orchestration surfaces, not business-logic layers.
- Do not implement indexing/retrieval logic in prompts.
- Do not bypass MCP contracts.
- If capability is missing, add it in code through architecture boundaries (`presentation -> application -> infrastructure`) before documenting it in prompts.

## v0.1 Capability Scope

Current stable MCP tools:

- `lkg.status`
- `lkg.index`
- `lkg.search`

Do not claim support for non-v0.1 tools in prompt assets.
