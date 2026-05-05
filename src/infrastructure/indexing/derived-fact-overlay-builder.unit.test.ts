import { describe, expect, it } from "vitest";

import { DerivedFactOverlayBuilder } from "./derived-fact-overlay-builder.js";

describe("DerivedFactOverlayBuilder", () => {
  it("partitions derived relations into deterministic overlay records", async () => {
    const builder = new DerivedFactOverlayBuilder();

    const records = await builder.build({
      derivedFacts: [
        {
          confidence: 0.9,
          contentHash: "hash-1",
          derivedFactId: "fact-1",
          evidenceId: "evidence-1",
          extractor: "derived-fact-builder",
          fileFingerprint: "fp-1",
          indexRunId: "run-1",
          kind: "caller-callee-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-a",
            fromKind: "SymbolCandidate",
            fromLabel: "main",
            toId: "symbol-b",
            toKind: "SymbolCandidate",
            toLabel: "helper",
          },
          sourceType: "code",
        },
        {
          confidence: 0.7,
          contentHash: "hash-2",
          derivedFactId: "fact-2",
          evidenceId: "evidence-2",
          extractor: "derived-fact-builder",
          fileFingerprint: "fp-2",
          indexRunId: "run-1",
          kind: "symbol-references-symbol-candidate",
          layer: "derived",
          path: "src/main.ts",
          payload: {
            fromId: "symbol-b",
            fromKind: "SymbolCandidate",
            fromLabel: "helper",
            toId: "symbol-c",
            toKind: "SymbolCandidate",
            toLabel: "dependency",
          },
          sourceType: "code",
        },
      ],
    });

    expect(records.map((record) => record.kind)).toEqual([
      "cfg",
      "data_flow",
      "pdg_lite",
    ]);
    expect(records[0]?.edges[0]).toMatchObject({
      fromId: "symbol-a",
      kind: "cfg-next",
      toId: "symbol-b",
    });
    expect(records[1]?.edges[0]).toMatchObject({
      fromId: "symbol-b",
      kind: "data-flow",
      toId: "symbol-c",
    });
    expect(records[2]?.edges).toEqual([]);
  });
});
