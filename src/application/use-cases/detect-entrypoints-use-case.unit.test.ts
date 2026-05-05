import { describe, expect, it, vi } from "vitest";

import { DetectEntrypointsUseCase } from "./detect-entrypoints-use-case.js";
import { ERROR_CODES, type LkgError } from "../../shared/errors/lkg-error.js";
import type { CanonicalFactStorePort } from "../ports/canonical-fact-store-port.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

function createIndexStatePort(
  status: Awaited<ReturnType<IndexStatePort["getStatus"]>>,
): IndexStatePort {
  return {
    getRecord: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(status),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markRunning: vi.fn(),
    markWatcherFailed: vi.fn(),
    markWatcherPending: vi.fn(),
    saveProgress: vi.fn(),
    saveStatusSnapshot: vi.fn(),
  };
}

function createCanonicalFactStore(
  records: Awaited<ReturnType<CanonicalFactStorePort["list"]>> = [],
): CanonicalFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
  };
}

function createDerivedFactStore(
  records: Awaited<ReturnType<DerivedFactStorePort["list"]>> = [],
): DerivedFactStorePort {
  return {
    clear: vi.fn(),
    deleteByPath: vi.fn(),
    list: vi.fn().mockResolvedValue(records),
    upsert: vi.fn(),
  };
}

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

describe("DetectEntrypointsUseCase", () => {
  const context = {
    activeProjectIdentity: "project-a",
    indexScope: "shared" as const,
  };

  const readyStatus = {
    activeProjectIdentity: "project-a",
    counters: { errors: 0, filesIndexed: 1, filesTotal: 1 },
    indexRunId: "run-1",
    indexScope: "shared" as const,
    lastError: null,
    lastIndexedAt: "2026-05-03T00:00:00.000Z",
    needsReindex: false,
    pendingChanges: false,
    state: "idle" as const,
    watcherState: "enabled" as const,
  };

  it("returns evidence-backed entrypoint candidates from canonical facts", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(readyStatus),
      createCanonicalFactStore([
        {
          confidence: 0.95,
          contentHash: "hash-1",
          evidenceId: "evidence-1",
          extractor: "artifact:repo-config",
          factId: "fact-1",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "package.json",
          payload: { command: "node dist/main.js", scriptName: "start" },
          sourceType: "code",
        },
      ]),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({ query: "start" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      command: "node dist/main.js",
      kind: "script",
      name: "start",
      path: "package.json",
      precisionTier: "derived",
    });
    expect(result.limitations?.[0]?.detail).toContain(
      "Phase 1 entrypoint detection",
    );
  });

  it("sorts deterministically by confidence, path, then name", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(readyStatus),
      createCanonicalFactStore([
        {
          confidence: 0.8,
          contentHash: "hash-z",
          evidenceId: "evidence-z",
          extractor: "artifact:repo-config",
          factId: "fact-z",
          fileFingerprint: "fp-z",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "z-package.json",
          payload: { command: "npm run zebra", scriptName: "zebra" },
          sourceType: "code",
        },
        {
          confidence: 0.9,
          contentHash: "hash-b",
          evidenceId: "evidence-b",
          extractor: "artifact:repo-config",
          factId: "fact-b",
          fileFingerprint: "fp-b",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "b-package.json",
          payload: { command: "npm run beta", scriptName: "beta" },
          sourceType: "code",
        },
        {
          confidence: 0.9,
          contentHash: "hash-a2",
          evidenceId: "evidence-a2",
          extractor: "artifact:repo-config",
          factId: "fact-a2",
          fileFingerprint: "fp-a2",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "a-package.json",
          payload: { command: "npm run zeta", scriptName: "zeta" },
          sourceType: "code",
        },
        {
          confidence: 0.9,
          contentHash: "hash-a1",
          evidenceId: "evidence-a1",
          extractor: "artifact:repo-config",
          factId: "fact-a1",
          fileFingerprint: "fp-a1",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "a-package.json",
          payload: { command: "npm run alpha", scriptName: "alpha" },
          sourceType: "code",
        },
      ]),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({});

    expect(
      result.results.map(
        (entrypoint) => `${entrypoint.path}:${entrypoint.name}`,
      ),
    ).toEqual([
      "a-package.json:alpha",
      "a-package.json:zeta",
      "b-package.json:beta",
      "z-package.json:zebra",
    ]);
  });

  it("filters by query, path, package, kind, confidence, and limit across canonical and derived entrypoints", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(readyStatus),
      createCanonicalFactStore([
        {
          confidence: 0.96,
          contentHash: "hash-canonical-match",
          evidenceId: "evidence-canonical-match",
          extractor: "artifact:repo-config",
          factId: "fact-canonical-match",
          fileFingerprint: "fp-canonical-match",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "packages/app-one/package.json",
          payload: { command: "npm run start-app", scriptName: "app-start" },
          sourceType: "code",
        },
        {
          confidence: 0.99,
          contentHash: "hash-canonical-other-kind",
          evidenceId: "evidence-canonical-other-kind",
          extractor: "artifact:repo-config",
          factId: "fact-canonical-other-kind",
          fileFingerprint: "fp-canonical-other-kind",
          indexRunId: "run-1",
          kind: "workflow",
          layer: "canonical",
          path: "packages/app-one/.github/workflows/ci.yml",
          payload: { workflowName: "app-ci" },
          sourceType: "code",
        },
        {
          confidence: 0.5,
          contentHash: "hash-canonical-low-confidence",
          evidenceId: "evidence-canonical-low-confidence",
          extractor: "artifact:repo-config",
          factId: "fact-canonical-low-confidence",
          fileFingerprint: "fp-canonical-low-confidence",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "packages/app-one/package.json",
          payload: {
            command: "npm run start-low",
            scriptName: "app-start-low",
          },
          sourceType: "code",
        },
      ]),
      createDerivedFactStore([
        {
          confidence: 0.97,
          contentHash: "hash-derived-match-a",
          derivedFactId: "derived-match-a",
          evidenceId: "evidence-derived-match-a",
          extractor: "derived-fact",
          fileFingerprint: "fp-derived-match-a",
          indexRunId: "run-1",
          kind: "file-declares-entrypoint-candidate",
          layer: "derived",
          path: "packages/app-one/src/bootstrap.ts",
          payload: {
            path: "packages/app-one/src/bootstrap.ts",
            toId: "entrypoint:app-bootstrap",
            toLabel: "app bootstrap",
          },
          sourceType: "code",
        },
        {
          confidence: 0.98,
          contentHash: "hash-derived-match-b",
          derivedFactId: "derived-match-b",
          evidenceId: "evidence-derived-match-b",
          extractor: "derived-fact",
          fileFingerprint: "fp-derived-match-b",
          indexRunId: "run-1",
          kind: "file-declares-entrypoint-candidate",
          layer: "derived",
          path: "packages/app-one/src/bootstrap.ts",
          payload: {
            path: "packages/app-one/src/bootstrap.ts",
            toId: "entrypoint:app-bootstrap-duplicate",
            toLabel: "app bootstrap",
          },
          sourceType: "code",
        },
        {
          confidence: 0.99,
          contentHash: "hash-derived-other-package",
          derivedFactId: "derived-other-package",
          evidenceId: "evidence-derived-other-package",
          extractor: "derived-fact",
          fileFingerprint: "fp-derived-other-package",
          indexRunId: "run-1",
          kind: "file-declares-entrypoint-candidate",
          layer: "derived",
          path: "packages/app-two/src/bootstrap.ts",
          payload: {
            path: "packages/app-two/src/bootstrap.ts",
            toId: "entrypoint:app-two-bootstrap",
            toLabel: "app bootstrap",
          },
          sourceType: "code",
        },
      ]),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({
      confidenceMin: 0.95,
      kind: "entrypoint",
      limit: 1,
      package: "app-one",
      query: "bootstrap",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      kind: "entrypoint",
      name: "app bootstrap",
      path: "packages/app-one/src/bootstrap.ts",
      precisionTier: "possible",
    });
  });

  it("returns bounded empty results when filters exclude all entrypoints", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(readyStatus),
      createCanonicalFactStore([
        {
          confidence: 0.95,
          contentHash: "hash-1",
          evidenceId: "evidence-1",
          extractor: "artifact:repo-config",
          factId: "fact-1",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "package_script",
          layer: "canonical",
          path: "package.json",
          payload: { command: "node dist/main.js", scriptName: "start" },
          sourceType: "code",
        },
      ]),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    const result = await useCase.execute({ query: "no-match" });

    expect(result.results).toEqual([]);
    expect(result.limitations?.[0]).toMatchObject({ kind: "bounded-analysis" });
  });

  it("rejects blank filters and enforces analysis readiness", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(null),
      createCanonicalFactStore(),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(useCase.execute({})).rejects.toMatchObject({
      code: ERROR_CODES.ANALYSIS_NOT_READY,
    } satisfies Partial<LkgError>);
  });

  it("rejects invalid filter values", async () => {
    const useCase = new DetectEntrypointsUseCase(
      createIndexStatePort(readyStatus),
      createCanonicalFactStore(),
      createDerivedFactStore(),
      createSymbolCandidateStore(),
      context,
    );

    await expect(useCase.execute({ query: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(useCase.execute({ path: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(useCase.execute({ package: "   " })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
    await expect(useCase.execute({ confidenceMin: 1.1 })).rejects.toMatchObject(
      {
        code: ERROR_CODES.INVALID_INPUT,
      } satisfies Partial<LkgError>,
    );
    await expect(useCase.execute({ limit: 0 })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_INPUT,
    } satisfies Partial<LkgError>);
  });
});
