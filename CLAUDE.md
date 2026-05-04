## Early-Stage Agent Guidance

Before making implementation decisions, read these first:

1. `docs/vision.md`
2. `docs/developer-guide.md`
3. `.claude/plan-0.3.md`

Treat `docs/vision.md` and `docs/developer-guide.md` as the source of truth for direction and architecture boundaries. Use the plan files as implementation-phase context: v0.1, v0.2 is complete, and v0.3 is the current in-flight foundation.

## Working Principles

Prioritize correctness, clarity, and evidence over speed.

- **Think Before Coding**
  - State assumptions explicitly before acting.
  - Do not guess through ambiguity; surface uncertainty and tradeoffs clearly.
  - Ask clarifying questions first when requirements are unclear.

- **Simplicity First**
  - Prefer the smallest solution that fully satisfies the request.
  - Avoid speculative abstractions, extra features, or configuration outside scope.

- **Surgical Changes**
  - Touch only the guidance or code necessary for the request.
  - Preserve existing style and patterns.
  - If you notice unrelated dead code, report it; do not remove it automatically.

- **Goal-Driven Execution**
  - Define verifiable success criteria before implementation.
  - Verify outcomes explicitly instead of assuming changes worked.

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

## LKG Operating Doctrine

Use this default workflow:

1. Check `lkg.status` first to evaluate health, freshness, and query readiness.
2. Run `lkg.index` only when status shows reindexing is needed, readiness is missing, or the user explicitly asks for indexing.
3. Use `lkg.search` for broad evidence retrieval when you are still locating relevant implementation or documentation.
4. Use `lkg.symbols` for candidate discovery when symbol identity is ambiguous.
5. Use `lkg.symbol` only after you know the target `path` and `symbol`, or after `lkg.symbols` narrows the candidates.
6. Read source files only after LKG retrieval narrows the scope.
7. Keep responses evidence-first with explicit path, location, and provenance.

### Practical tool order

- **Operational flow**: `lkg.status` -> `lkg.index` if needed -> `lkg.status` again if you need a post-index snapshot.
- **Broad retrieval flow**: `lkg.status` if freshness matters -> `lkg.search` -> read narrowed files.
- **Symbol flow**: `lkg.status` if readiness is uncertain -> `lkg.symbols` -> `lkg.symbol` -> read narrowed files.

## Current Skills

Current skills are thin orchestration wrappers over the implemented MCP tools. They must stay 1:1 with the runtime tool surface and must not add business logic, synthetic reasoning, or unsupported retrieval behavior.

- `lkg-status` -> `lkg.status`
- `lkg-index` -> `lkg.index`
- `lkg-search` -> `lkg.search`
- `lkg-symbols` -> `lkg.symbols`
- `lkg-symbol` -> `lkg.symbol`

Use a skill when the task is a direct single-tool action and the intended MCP operation is already clear.

## Current Agents

Current agents are orchestration-only surfaces that coordinate the implemented MCP tools without adding product logic.

- `LKG Manager` (`agents/manager.md`)
  - Use for status-first lifecycle work.
  - Handles readiness checks, conditional indexing, and post-index status verification.
  - Scope is limited to `lkg.status` and `lkg.index`.

- `LKG Explorer` (`agents/explorer.md`)
  - Use for retrieval workflows.
  - Handles evidence search, candidate-first symbol discovery, and symbol detail lookup.
  - Scope is limited to `lkg.search`, `lkg.symbols`, `lkg.symbol`, and optional freshness checks through `lkg.status`.

Use an agent when the task needs multi-step orchestration across the current MCP tools. Use a skill when one exact tool action is enough.

## Boundary Rules

- `agents/` and `skills/` are orchestration surfaces, not business-logic layers.
- Skills must remain thin 1:1 wrappers over implemented MCP tools.
- Agents may coordinate current MCP tools, but must not invent product logic or bypass MCP contracts.
- Do not implement indexing or retrieval logic in prompts.
- If capability is missing, add it in code through architecture boundaries (`presentation -> application -> infrastructure`) before documenting it in prompts.

## Capability and Roadmap Scope

Current available MCP tools:

- `lkg.status`
- `lkg.index`
- `lkg.search`
- `lkg.symbols`
- `lkg.symbol`

Current operational scope:

- The current stable public MCP surface is `lkg.status`, `lkg.index`, `lkg.search`, `lkg.symbols`, and `lkg.symbol`.
- `lkg.status`, `lkg.index`, and `lkg.search` remain the baseline operational workflow.
- `lkg.symbols` and `lkg.symbol` are stable v0.2 capabilities, but prompt assets must still describe them conservatively as candidate-first, provenance-rich symbol capabilities rather than flow/impact-grade certainty.
- Do not claim support for later-phase tools such as `lkg.graph`, `lkg.impact`, `lkg.flow`, `lkg.context`, `lkg.arch`, or `lkg.ask` until they are implemented and stable in code.
