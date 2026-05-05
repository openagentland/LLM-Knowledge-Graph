# LKG Vision: Knowledge Intelligent System for AI Agents

## 1) Core destination

LKG is a **local-first, MCP-first** system that helps AI agents deeply understand software projects, from code to documentation. LKG positions itself as a **Knowledge Intelligent System for AI Agents**: transforming project data into structured, evidence-bearing knowledge that can be retrieved, traversed, verified, and used by agent runtimes for grounded reasoning.

The goal is not just to “find code,” but to help agents answer key questions accurately:

- How does the system work?
- Why is the architecture organized this way?
- If we change X, what will the impact be?
- Do the documentation and implementation actually match?

LKG must support understanding in both directions:

- **Top-down:** project goals → architecture → module/concept → file/symbol → implementation.
- **Bottom-up:** symbol/flow/dependency → behavior → architectural role → intent.

## 2) Sources of inspiration (learning mechanisms, not dependencies)

LKG draws from the best systems in terms of **mechanisms and mental models**, without depending on the code or runtime of any external repository.

1. **SocratiCode**: micro-level understanding, bottom-up from file/symbol/flow.
2. **GraphRAG**: macro-level understanding, top-down through graph/community summaries.
3. **OpenSPG KAG**: schema-aware builder/solver, multi-step reasoning.
4. **Meta Glean**: structured code facts, derived facts, queryable code intelligence.
5. **Unstructured**: file-type-based document ingestion, partitioning, metadata/provenance.
6. **Joern**: CPG + AST/CFG/data-flow/PDG, slicing, analysis rules.

LKG combines these strengths into its own core architecture: Node.js-native, local-first, MCP-first, and agent-native.

## 3) Architectural principles

### 3.1 MCP-first, capability-oriented tools

The tool surface is a long-term contract with AI agents; tools represent cognitive capabilities rather than exposing implementation details.

### 3.2 Local-first, zero-management

Runs locally by default, stores data in `.lkg/`, and does not force a cloud setup.

### 3.3 Clean architecture + DDD boundaries

```txt
domain <- application <- infrastructure
```

Providers and backends must come after ports/interfaces.

### 3.4 Continuous awareness

The watcher is default runtime behavior (can be disabled with `LKG_DISABLE_WATCHER=true`), and watcher failures must not crash the server.

### 3.5 Evidence-first knowledge

Every result must be traceable back to evidence (path, line, symbol, section, schema/config, graph provenance).

### 3.6 Stable contracts, evolving capabilities

Tool names and response shapes should remain stable over time; capabilities can evolve incrementally behind them.

### 3.7 Inspiration without dependency

All inspirations are blueprints for mechanisms only; LKG must not be locked into the runtime, schema, or deployment model of any external system.

## 4) Core knowledge pipeline

```txt
source code / docs / configs / schemas / artifacts
→ structured elements & facts
→ AST/CFG/data-flow/PDG/CPG layers
→ unified graph
→ derived facts
→ summaries
→ retrieval / traversal / evidence-bearing knowledge artifacts
```

In short:

- **Structured elements & facts:** code facts and document elements with metadata.
- **Program-analysis layers:** AST/CFG/data-flow/PDG/CPG for deep behavioral understanding.
- **Unified graph:** connects code, docs, concepts, modules, decisions, configs, and tests.
- **Derived facts:** caller/callee, impact paths, concept realization, test relations, and more.
- **Summaries:** module/concept/architecture/community/knowledge-unit summaries.
- **Retrieval and traversal surfaces:** evidence-first access paths that agent runtimes can use for grounded reasoning, synthesis, and verification.

## 5) Key capability layers

### 5.1 Structured code fact layer (Glean-inspired)

- Raw facts: definition/reference/import/call/type/test/config/route...
- Derived facts: callers/callees, dependency, impact, ownership, realization...
- Modular indexers: native extractors, compiler APIs, LSP, SCIP/LSIF importers.

### 5.2 Document understanding layer (Unstructured-inspired)

- Detect file type → partition elements → preserve metadata/provenance → chunk/enrich/index → link into the graph.
- Supports docs/specs/ADRs/schemas/configs/artifacts, with a path to optional PDF/OCR/Office support.

### 5.3 Program analysis graph layer (Joern-inspired)

- AST, CFG, data-flow, PDG, and CPG are first-class concepts.
- Includes slicing and reusable analysis rules to support flow, impact, and security reasoning.

### 5.4 Builder and downstream reasoning consumers (KAG-inspired)

- **Builder (`lkg.index`)**: builds facts/elements/graph/derived facts/summaries.
- **Reasoning consumers**: agent runtimes or optional higher-level gateways can plan → retrieve → traverse → verify → synthesize on top of LKG's evidence-bearing knowledge surfaces.

## 6) Long-term MCP tool surface

- **`lkg.status`**: reports system state (indexing, watcher, storage/provider health, latest errors, data freshness) so the agent knows how much it can trust the current knowledge.
- **`lkg.index`**: triggers/controls the indexing lifecycle (full/incremental/rebuild) and synchronizes source code + docs + artifacts into the knowledge pipeline.
- **`lkg.search`**: unified search across code/docs/facts/graph neighborhoods, prioritizing evidence with provenance so agents can quickly locate what they should read.
- **`lkg.symbols`**: lists/searches symbols by file, module, pattern, or semantic intent; used to map API surfaces and entry points.
- **`lkg.symbol`**: provides a 360° view of a symbol (definition, references, callers, callees, related tests/config/docs) with supporting evidence.
- **`lkg.graph`**: queries the multi-layer graph (code-doc-concept-module-decision) to understand relationships and architectural topology.
- **`lkg.impact`**: analyzes the blast radius of changing X (symbol/file/module/concept), showing dependency propagation paths and risk areas.
- **`lkg.flow`**: traces execution/data/control flow to answer “how does the system run?”, with drill-down from macro flow to line-level evidence.
- **`lkg.context`**: retrieves normalized knowledge units (docs/specs/ADRs/schemas/configs/artifacts) and links them to the implementation.
- **`lkg.arch`**: synthesizes the architectural view (module boundaries, responsibilities, coupling, consistency/drift signals, decision alignment).
- **`lkg.ask`**: an optional multi-step reasoning Q&A gateway; it can orchestrate retrieve → traverse → verify → synthesize for hosts that want a built-in convenience layer on top of the core knowledge substrate.

Principles:

- Compact, stable, capability-oriented.
- Not named after specific engines/providers.
- `lkg.search` prioritizes evidence; `lkg.ask`, if provided, synthesizes on top of that evidence.

## 7) Product identity and configuration

- Name: **LLM Knowledge Graph (LKG)**
- Package: `@openagentland/lkg`
- Primary interface: MCP
- Env prefix: `LKG_`
- Default local data dir: `LKG_HOME` (defaults to `~/.lkg/`, not committed)

Default local stack direction:

- llama.cpp-compatible embeddings
- LanceDB vector store
- Kuzu graph store

Possible extended providers include: Ollama, Voyage, OpenAI, Google, Anthropic, Qdrant, Neo4j.

## 8) Concise roadmap by milestone

### Milestone 1 — usable local semantic slice

- Stable MCP server
- `lkg.status`, `lkg.index`, `lkg.search`
- Local semantic indexing/search, idempotent, respecting ignore rules

### Milestone 2 — structured code facts + symbol/graph foundation

- Structured fact model
- Raw/derived fact boundaries
- Symbol extraction/search/inspection
- Graph foundation
- Stable public MCP surface: `lkg.status`, `lkg.index`, `lkg.search`, `lkg.symbols`, `lkg.symbol`
- Internal graph remains implementation-owned; deeper graph traversal and reasoning stay deferred to Milestone 3 and beyond

### Milestone 3 — deep flow/impact reasoning

- Entrypoint detection
- Flow tracing, impact analysis
- Initial program-analysis overlays (CFG/data-flow/PDG) and slicing

### Milestone 4 — context/document intelligence

- File-type-aware ingestion
- Document partitioning + metadata preservation
- Context artifact indexing/search

### Milestone 5 — macro architecture intelligence

- Concept/entity/relationship alignment
- Community & module summaries
- Architecture analysis + consistency/risk signals

### Milestone 6 — grounded project Q&A

- Optional `lkg.ask` convenience gateway
- Multi-step reasoning orchestration for hosts that want a built-in Q&A layer
- Citation + uncertainty
- Production-grade combination of top-down and bottom-up understanding over the core knowledge substrate

## 9) What LKG should not become

- Not just a semantic search wrapper.
- Must not expose tools tied to specific backends/providers.
- Must not create too many micro-tools that force agents to orchestrate manually.

## 10) Final destination

LKG becomes the project knowledge layer that enables AI agents to:

- find the right relevant code and documentation,
- deeply understand symbols, flows, dependencies, and impact,
- connect implementation to architecture and intent,
- reason and answer with evidence, clear citations, and explicit uncertainty,
- operate like a maintainer with both macro and micro understanding.
