## Early-Stage Agent Guidance

Before making implementation decisions, read these first:

1. `docs/vision.md`
2. `docs/developer-guide.md`

Treat `docs/vision.md` and `docs/developer-guide.md` as the source of truth for direction and architecture boundaries. Use the plan files as implementation-phase context; Milestones 1-4 are complete

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
- For implementation work, run five separate verification subagents, one for each command: `npm run lint:fix`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, and `npm run build`. Run build last because this repo uses its own plugin/MCP surfaces during development. Do not require the full verification set for docs-only, prompt-only, metadata-only, or configuration-only edits unless those edits affect runtime behavior. Report any skipped or failed gate explicitly.

## Subagent Coordination

The main agent owns planning, synthesis, implementation decisions, and final reporting. Use subagents only for bounded, independent work that preserves the main session's context.

- Delegate code exploration, large-output summarization, focused review, and independent verification commands to subagents when that reduces main-context noise.
- Do not delegate open-ended ownership such as "find and fix the issue" unless the main agent has already narrowed the scope, success criteria, and allowed actions.
- Prompt each subagent with the goal, relevant context, exact scope, whether code changes are allowed, and the expected report format.
- Ask subagents for concise, evidence-backed findings: file paths, symbols, failing commands, risks, and actionable recommendations rather than full transcripts.
- Treat subagent reports as evidence, not decisions. The main agent must synthesize results, verify important claims when needed, and decide the next step.
- Run independent verification subagents in parallel when possible. Keep `npm run build` last because this repo uses its own plugin/MCP surfaces during development.

## Context Compaction Discipline

- Use subagents to isolate large research, long logs, broad code exploration, and independent verification from the main conversation context.
- Subagents should return concise summaries with only actionable findings, relevant file paths, symbols, failing commands, risks, and recommended next steps.
- Do not paste raw logs, full transcripts, or large exploratory outputs into the main thread unless explicitly requested.
- When context becomes long or after a large subagent or research phase, consider compacting before starting implementation or verification.
- During compaction, preserve the current goal, accepted plan, constraints, files being edited, key decisions, subagent conclusions, open questions, and pending verification steps.
- During compaction, drop exploratory chatter, repeated tool output, superseded hypotheses, raw logs, and details that are no longer actionable.

## Dogfooding Discipline

This repository should use LKG to develop LKG.

- For non-trivial code exploration, start with `lkg.status`, then use the narrowest applicable LKG retrieval tool before reading files.
- If an LKG tool returns stale, missing, low-confidence, or confusing evidence, report that as product feedback instead of silently hiding it.
- Fallback to grep/ripgrep only for exact strings, regex patterns, or when LKG is not ready.
- When LKG results guide an implementation decision, cite the relevant evidence path/symbol in the response.

## Codebase Search

This project is indexed with LLM Knowledge Graph (LKG). Use LKG's MCP tools to explore the codebase before reading files directly, unless you already know the exact file or string you need.

### Current stable LKG tools

The stable public tool surface is documented in `docs/developer-guide.md` and currently includes:

- `lkg.status`: inspect index lifecycle state, watcher/runtime health, freshness, and recent errors.
- `lkg.index`: start an index lifecycle run (`full`, `incremental`, or `rebuild`).
- `lkg.search`: search indexed project knowledge and return ranked evidence with provenance.
- `lkg.symbols`: list or search symbol candidates by path, kind, source type, or text query.
- `lkg.symbol`: inspect one symbol candidate with provenance-rich evidence.
- `lkg.entrypoints`: list evidence-backed entrypoint candidates.
- `lkg.flow`: trace bounded flow segments from an anchor.
- `lkg.impact`: analyze bounded impact from a target anchor.
- `lkg.slice`: return a bounded evidence slice around a criterion anchor.

Do not refer to SocratiCode tool names such as `codebase_search`, `codebase_graph_query`, `codebase_graph_circular`, `codebase_graph_visualize`, `codebase_context`, or `codebase_context_search` unless those tools are actually implemented in this repository.

### Workflow

1. **Start non-trivial explorations with `lkg.status`.**
   Use `lkg.status` before broad code exploration, when search fails, when results look stale, or when you need to know whether indexing/watching is healthy.
   - If the index is not ready or stale, use `lkg.index` with the smallest appropriate mode.
   - While an index run is active, check `lkg.status` periodically instead of starting duplicate index runs.

2. **Start most explorations with `lkg.search`.**
   `lkg.search` is the default entry point for broad or uncertain questions because it returns ranked, provenance-backed evidence.
   - Use broad conceptual queries for orientation: "index lifecycle", "daemon registry", "symbol extraction".
   - Use precise queries for known concepts, types, functions, errors, or feature names.
   - Prefer search results to decide which 1-3 files or symbols to inspect next.
   - Use grep/ripgrep instead when you already know the exact string, identifier, or regex pattern.

3. **Use symbol tools for candidate-first code understanding.**
   Use `lkg.symbols` and `lkg.symbol` when the question is about definitions, symbol candidates, or symbol-level evidence.
   - `lkg.symbols` helps list symbols in a file or search for symbols across the project.
   - `lkg.symbol` gives detail for a specific symbol/path pair, including evidence and relationships where available.

4. **Use graph-style reasoning tools for bounded questions.**
   Use the higher-level reasoning tools when the question is about runtime behavior, entrypoints, or blast radius.
   - `lkg.entrypoints` answers “where can execution or workflows start?”
   - `lkg.flow` answers “what does this code path do?” from a bounded anchor.
   - `lkg.impact` answers “what might be affected if this target changes?”
   - `lkg.slice` gathers a bounded evidence neighborhood around a criterion.

5. **Read files only after narrowing the target.**
   Once LKG or grep clearly identifies relevant files, read only the needed sections. Do not open files speculatively just to determine whether they are relevant.

### When to use each tool

| Goal                                        | Tool              |
| ------------------------------------------- | ----------------- |
| Check whether the index/runtime is usable   | `lkg.status`      |
| Start or refresh indexing                   | `lkg.index`       |
| Understand where a feature/concept lives    | `lkg.search`      |
| Find ranked evidence across code/docs/facts | `lkg.search`      |
| Find exact strings or regex patterns        | grep / ripgrep    |
| List/search symbols                         | `lkg.symbols`     |
| Inspect one symbol candidate                | `lkg.symbol`      |
| Discover entrypoints                        | `lkg.entrypoints` |
| Trace behavior from an anchor               | `lkg.flow`        |
| Estimate blast radius of a change           | `lkg.impact`      |
| Collect a bounded evidence neighborhood     | `lkg.slice`       |

> **Why LKG search first?** A single `lkg.search` call gives a compact, evidence-backed map of relevant code and documentation. After that, targeted reads are faster and more accurate than opening files speculatively.

> **Keep the connection alive during indexing.** Indexing runs in the background. If an index run is active, call `lkg.status` periodically until it completes instead of starting another `lkg.index` run.
