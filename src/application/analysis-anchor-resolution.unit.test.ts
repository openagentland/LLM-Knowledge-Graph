import { describe, expect, it, vi } from "vitest";

import {
  detectRelationEndpointMatch,
  mapOppositeRelationAnchor,
  relationMatchesDirection,
  relationUsesInclude,
  resolveAnalysisAnchor,
} from "./analysis-anchor-resolution.js";
import type { SymbolCandidateStorePort } from "./ports/symbol-candidate-store-port.js";
import { ERROR_CODES, type LkgError } from "../shared/errors/lkg-error.js";

function createSymbolCandidateStore(
  records: Awaited<ReturnType<SymbolCandidateStorePort["list"]>> = [],
): SymbolCandidateStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
  };
}

describe("analysis-anchor-resolution", () => {
  it("resolves symbol anchors without ids through candidate-first lookup", async () => {
    const store = createSymbolCandidateStore([
      {
        codeLocation: { endLine: 3, startLine: 1 },
        contentHash: "hash-main",
        evidenceId: "symbol-main",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-main",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/main.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
    ]);

    const resolved = await resolveAnalysisAnchor(
      { kind: "symbol", name: "main", path: "src/main.ts", sourceType: "code" },
      store,
    );

    expect(resolved).toMatchObject({
      id: "symbol-main",
      name: "main",
      path: "src/main.ts",
    });
  });

  it("prefers exact path matches during candidate-first symbol resolution", async () => {
    const store = createSymbolCandidateStore([
      {
        codeLocation: { endLine: 30, startLine: 20 },
        contentHash: "hash-other",
        evidenceId: "symbol-other",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-other",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/other.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
      {
        codeLocation: { endLine: 3, startLine: 1 },
        contentHash: "hash-main",
        evidenceId: "symbol-main",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-main",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/main.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
    ]);

    const resolved = await resolveAnalysisAnchor(
      { kind: "symbol", name: "main", path: "src/main.ts", sourceType: "code" },
      store,
    );

    expect(resolved.id).toBe("symbol-main");
    expect(resolved.path).toBe("src/main.ts");
  });

  it("rejects ambiguous symbol anchors", async () => {
    const store = createSymbolCandidateStore([
      {
        codeLocation: { endLine: 3, startLine: 1 },
        contentHash: "hash-a",
        evidenceId: "symbol-a",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-a",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/main.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
      {
        codeLocation: { endLine: 8, startLine: 6 },
        contentHash: "hash-b",
        evidenceId: "symbol-b",
        extractor: "ast-grep:function_declaration",
        fileFingerprint: "fp-b",
        indexRunId: "run-1",
        kind: "function_declaration",
        language: "ts",
        name: "main",
        path: "src/main.ts",
        scope: "file",
        signature: "function main()",
        sourceType: "code",
      },
    ]);

    await expect(
      resolveAnalysisAnchor(
        {
          kind: "symbol",
          name: "main",
          path: "src/main.ts",
          sourceType: "code",
        },
        store,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.AMBIGUOUS_ANCHOR,
    } satisfies Partial<LkgError>);
  });

  it("resolves non-symbol anchors from path fallback", async () => {
    const resolved = await resolveAnalysisAnchor(
      {
        kind: "file",
        name: "main.ts",
        path: "src/main.ts",
        sourceType: "code",
      },
      createSymbolCandidateStore(),
    );

    expect(resolved.id).toBe("file:src/main.ts");
  });

  it("detects reverse endpoint matches and maps the opposite endpoint", () => {
    const fact = {
      codeLocation: { endLine: 12, startLine: 10 },
      path: "src/main.ts",
      payload: {
        fromId: "symbol-caller",
        fromKind: "symbol",
        fromLabel: "caller",
        toId: "symbol-target",
        toKind: "symbol",
        toLabel: "target",
      },
      sourceType: "code" as const,
    };

    const matchedEndpoint = detectRelationEndpointMatch(fact, {
      id: "symbol-target",
      kind: "symbol",
      name: "target",
      path: "src/main.ts",
      sourceType: "code",
    });

    expect(matchedEndpoint).toBe("to");
    expect(
      mapOppositeRelationAnchor({
        fallbackKind: "symbol",
        fallbackPath: fact.path,
        matchedEndpoint: matchedEndpoint ?? "from",
        relation: fact,
      }),
    ).toMatchObject({
      id: "symbol-caller",
      name: "caller",
    });
  });

  it("maps fallback anchors without self-reference when relation payload is partial", () => {
    const fact = {
      codeLocation: { endLine: 12, startLine: 10 },
      path: "src/main.ts",
      payload: {
        fromId: "symbol-target",
        fromKind: "symbol",
        fromLabel: "target",
      },
      sourceType: "code" as const,
    };

    const opposite = mapOppositeRelationAnchor({
      fallbackKind: "file",
      fallbackPath: fact.path,
      matchedEndpoint: "from",
      relation: fact,
    });

    expect(opposite).toMatchObject({
      id: "file:src/main.ts",
      kind: "file",
      name: "src/main.ts",
      path: "src/main.ts",
    });
  });

  it("matches relation directions consistently", () => {
    expect(relationMatchesDirection("from", "forward")).toBe(true);
    expect(relationMatchesDirection("to", "forward")).toBe(false);
    expect(relationMatchesDirection("from", "backward")).toBe(false);
    expect(relationMatchesDirection("to", "backward")).toBe(true);
    expect(relationMatchesDirection("from", "both")).toBe(true);
    expect(relationMatchesDirection("to", "both")).toBe(true);
  });

  it("only enables supported relation kinds for include filters", () => {
    expect(
      relationUsesInclude("caller-callee-candidate", new Set(["calls"])),
    ).toBe(true);
    expect(relationUsesInclude("file-imports-file", new Set(["imports"]))).toBe(
      true,
    );
    expect(relationUsesInclude("task-runs-command", new Set(["config"]))).toBe(
      true,
    );
    expect(
      relationUsesInclude("caller-callee-candidate", new Set(["control"])),
    ).toBe(false);
    expect(
      relationUsesInclude("caller-callee-candidate", new Set(["data"])),
    ).toBe(false);
    expect(relationUsesInclude("task-runs-command", new Set(["calls"]))).toBe(
      false,
    );
  });
});
