# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LLM-Knowledge-Graph, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **[john.itvn@gmail.com](mailto:john.itvn@gmail.com)** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

You will receive an acknowledgement within 48 hours and a detailed response within 7 days indicating next steps.

## Scope

This policy applies to the LLM-Knowledge-Graph codebase and its managed Docker infrastructure (Qdrant and Ollama containers). It does not cover third-party services you may connect to (cloud Qdrant, Neo4J, Ollama, OpenAI API, Voyage API, Google Gemini API).

## Security Model

LLM-Knowledge-Graph is designed to run locally by default:

- **No data exfiltration** — In the default configuration (Ollama + Docker Qdrant), all data stays on your machine. No external API calls are made.
- **No network listeners** — The MCP server communicates over stdio only. It does not open any HTTP endpoints.
- **Docker isolation** — Qdrant and Ollama run in Docker containers with only the necessary ports exposed on localhost.
- **No credentials stored** — API keys (OpenAI, Google, Qdrant, Neo4j, Voyage, Ollama) are passed via environment variables at runtime, never written to disk.

### When cloud providers are used

If you configure external LLM provider, code chunks are sent to the respective cloud API for embedding generation. This is an explicit opt-in. The default configuration never contacts external services.

## Supported Versions

Only the latest release is supported with security updates.

| Version | Supported |
| ------- | --------- |
| Latest  | Yes       |
| Older   | No        |

## Disclosure Policy

- Vulnerabilities will be patched and released as soon as practical
- A security advisory will be published on GitHub after the fix is available
- Credit will be given to reporters unless they prefer to remain anonymous
