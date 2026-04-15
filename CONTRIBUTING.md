# Contributing to LLM-Knowledge-Graph

Thank you for your interest in contributing to LLM-Knowledge-Graph! This document explains the process for contributing and what to expect.

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for integration and E2E tests)
- Git

### Setup

```bash
git clone https://github.com/openagentland/LLM-Knowledge-Graph.git
cd llm-knowledge-graph
npm install
npm run build
```

### Running Lint, Test, and Build

```bash
# Linting
npm run lint:fix

# Unit tests (no Docker needed)
npm run test:unit

# Integration tests (requires Docker)
npm run test:integration

# End-to-end tests (requires Docker)
npm run test:e2e

# All tests
npm test

# Building
npm run build
```

See the [Developer Guide](docs/developer-guide.md) for architecture details, data flows, and how the test infrastructure works.

## How to Contribute

### Reporting Bugs

Use the [Bug Report](https://github.com/openagentland/llm-knowledge-graph/issues/new?template=bug_report.yml) issue template. Include:

- Steps to reproduce
- Expected vs actual behaviour
- Your environment (OS, Node.js version, embedding provider, MCP host)
- Log output if available

### Suggesting Features

Use the [Feature Request](https://github.com/openagentland/llm-knowledge-graph/issues/new?template=feature_request.yml) issue template. Explain the problem you're trying to solve and your proposed approach.

### Submitting Pull Requests

1. **Fork** the repository and create a branch from `main`
2. **Make your changes** — follow the existing code style and conventions
3. **Add tests** — new functionality needs test coverage; bug fixes should include a regression test
4. **Update documentation** — if your changes affect the public API, update README.md and/or docs/developer-guide.md
5. **Verify** — run `npm run lint && npm run test:unit && npm run build`
6. **Open a PR** — fill out the pull request template
7. **Expect local hooks to run on commit** — `.husky/pre-commit` runs `npx lint-staged` and `npm run test`

### Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) to auto-generate the changelog:

```
feat: add fuzzy search support
fix: resolve race condition in watcher
docs: update quickstart guide
refactor: simplify provider factory
test: add watcher edge-case tests
chore: update dependencies
```

Prefix with the type, then a short imperative description. Use `feat:` for new features, `fix:` for bug fixes, and `chore:` for maintenance that doesn't need a changelog entry.

### What Makes a Good PR

- **Focused** — one logical change per PR
- **Tested** — unit tests at minimum; integration tests for infrastructure changes
- **Documented** — public-facing changes include the necessary updates to README.md and/or docs/developer-guide.md
- **Clean history** — squash fixup commits before requesting review
- **Conventional commits** — use the format above so the changelog generates correctly

## Code Style

- **TypeScript** with strict mode enabled
- **ESM** (ES modules) — use `.js` extensions in imports
- **Functional style** — prefer pure functions, avoid classes where unnecessary
- **Structured logging** — use `logger.info/warn/error/debug` with context objects, not `console.log`
- **Error messages** — user-friendly, actionable, include troubleshooting hints
- **JSDoc** on all exported functions
- **SPDX license header** on all source files:
  ```typescript
  // SPDX-License-Identifier: MIT
  // Copyright (C) 2026 John Martin
  ```

See [docs/developer-guide.md](docs/developer-guide.md) for the full architecture overview.

## Review Process

- All PRs are reviewed by a maintainer
- [CodeRabbit](https://coderabbit.ai) automatically reviews every PR — address or resolve all comments before requesting human review
- CI must pass (lint, tests, and build)
- One approval required to merge
- Maintainers may request changes or suggest alternatives

## Questions?

- Open a [Discussion](https://github.com/openagentland/llm-knowledge-graph/discussions) for questions
- Check the [README](README.md) and [Developer Guide](docs/developer-guide.md) for existing documentation

Thank you for helping make LLM-Knowledge-Graph better!
