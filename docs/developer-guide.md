# LLM Knowledge Graph (LKG) - Developer Guide

## 1. Design principles

1. **Keep it simple first, expand later**
   - Prefer the smallest structure that can ship quickly.
   - Split packages only when there is a real need (build bottlenecks, independent releases, or clear ownership boundaries).

2. **Keep logical boundaries clear even within a single `src/`**
   - A mono-src layout must not blur responsibilities.
   - Dependency rules still apply: `presentation -> application -> domain`, `infrastructure -> application/domain (through ports)`.

3. **MCP-first tool contract**
   - The tool surface stays stable around capabilities (`lkg.status`, `lkg.index`, `lkg.search`, ...).
   - Do not name tools around specific providers or backends.

4. **Evidence-first**
   - Query and reasoning results must always be traceable back to evidence (path, symbol, line, source).

5. **Local-first**
   - Run locally by default, with no forced cloud dependency.

6. **Zero-management first**
   - The system should still run with no configuration.
   - Configuration should mainly exist to improve performance and quality, not to make the system usable at all.

---

## 2. Standard directory structure

```txt
.
├── docs/
├── src/
│   ├── domain/              # Business concepts, entities, value objects, domain services
│   ├── application/         # Use cases, ports, orchestration, DTOs
│   ├── infrastructure/      # Adapters for DB/vector/LLM/fs/parser/config
│   ├── presentation/        # MCP handlers/tools, CLI entrypoints
│   ├── shared/              # Shared types/errors/utils that are truly cross-cutting
│   └── main.ts              # Composition root
└── tests/
    ├── integration/
    ├── e2e/
    └── fixtures/
```

---

## 3. Test strategy

### 3.1 Colocated unit tests (required)

Place unit tests next to the source file:

```txt
src/application/use-cases/index/
├── IndexFileUseCase.ts
└── IndexFileUseCase.unit.test.ts
```

### 3.2 Separate integration and E2E tests

```txt
tests/
├── integration/
│   └── indexing-flow.integration.test.ts
├── e2e/
│   └── mcp-server.e2e.test.ts
└── fixtures/
```

## 4. Conceptual architecture

### Domain

- Contains LKG's core business concepts (symbol, relationship, knowledge unit, ...).
- Must not contain framework-, protocol-, or database-dependent code.

### Application

- Contains use cases and orchestration.
- Defines the ports/interfaces that infrastructure must implement.

### Infrastructure

- Implements adapters for graph/vector/LLM/filesystem/parsers.
- Must not contain business rules.

### Presentation

- MCP tools, CLI commands, input/output mapping.
- Must not contain business logic.

### Composition root

- Wire the full dependency graph in `src/main.ts` (or `src/presentation/.../server.ts`).
- Do not scatter wiring across multiple places.

---

## 5. Coding conventions

1. **Naming**
   - Class/type/interface: `PascalCase`
   - Variable/function: `camelCase`
   - Constant: `UPPER_SNAKE_CASE`

2. **Imports**
   - Order: Node built-in -> external -> internal.
   - Avoid imports that break layer direction.

3. **Errors**
   - Domain/Application: return errors in the project's standard form (`Result` or typed errors), and avoid arbitrary throws.
   - Presentation: map errors into the output protocol (MCP/CLI).

4. **Function design**
   - Keep functions short and intent-revealing.
   - Avoid premature abstraction.
   - Do not add functionality beyond the use case scope.

5. **Comments**
   - Do not write comments that describe “what” by default.
   - Only comment when the non-obvious “why” needs explanation.

6. **Security baseline**
   - Validate input at boundaries (MCP/CLI/API).
   - Do not trust external input; avoid command injection and path traversal.

---

## 6. Development workflow

### 6.1 Local verification commands

Use the repository scripts in `package.json` as the default development workflow:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Notes:

- `npm run test:integration` and `npm run test:e2e` require Docker.
- `npm test` runs the full Vitest suite.
- `npm run build` is part of the standard verification path and should stay green.

### 6.2 Git hooks

The repository uses Husky pre-commit hooks.

Current pre-commit behavior:

- `npx lint-staged`
- `npm run test`

Keep commits small enough that these checks remain practical.

### 6.3 CI expectations

GitHub Actions currently verifies:

- Core validation on Node.js 18, 20, and 22: lint, unit tests, and build.
- Integration and E2E coverage on Node.js 22.

If you change scripts or test layout, update CI and contributor documentation together.

---

## 7. Integration and distribution surfaces

The artifacts below are part of the project's integration and distribution architecture, not incidental details.

### 7.1 Plugin manifests for each AI host

- `.claude-plugin/plugin.json`: metadata and wiring for the Claude host.
- `.claude-plugin/marketplace.json`: metadata for publish/discovery in the corresponding marketplace.
- `.codex-plugin/plugin.json`: metadata and wiring for the Codex host.
- `.cursor-plugin/plugin.json`: metadata and wiring for the Cursor host.
- `.cursor-plugin/marketplace.json`: metadata for publish/discovery in the corresponding marketplace.
- `gemini-extension.json`: extension manifest for Gemini, using `contextFileName` and declaring the MCP server.

Principles:

- Server name, package name, version, and command wiring must stay consistent across hosts.
- When capabilities or release metadata change, update all related manifests together.

### 7.2 MCP server descriptors and registry metadata

- `server.json`: the standard MCP server descriptor (name, repository, packages, transport) used for distribution and tool integration.
- `glama.json`: metadata schema for the Glama-compatible ecosystem/registry.

Principles:

- `server.json` is the source of truth for MCP server identity at the distribution level.
- `glama.json` and other registry metadata must reflect the current maintainers and identity accurately.

### 7.3 Runtime customization surfaces

- `hooks/hooks.json`: declares hook points and runtime extension behavior.
- `skills/`: custom skill/slash-command surfaces for the project (enabled according to feature maturity).
- `agents/`: custom agent definitions for delegated workflows in the project context.

Current state:

- The project is still in an early stage, so `skills/` and `agents/` should stay minimal to avoid describing capabilities beyond the implementation.
- Add detailed content to `skills/` and `agents/` only when the corresponding feature actually exists in the codebase.

---

_This developer guide is a living document. Update it as the project evolves._
