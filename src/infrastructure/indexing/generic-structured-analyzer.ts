import { createHash } from "node:crypto";

import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type { StructuredObservation } from "../../application/dto/structured-observations.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";
import {
  createFileObservation,
  createObservationId,
} from "../indexing/default-language-registry.js";

export class GenericStructuredAnalyzer implements StructuredAnalyzerPort {
  supports(document: ParsedDocument): boolean {
    return document.sourceType === "code" && document.language !== null;
  }

  analyze(context: {
    document: ParsedDocument;
    indexRunId: string;
  }): Promise<StructuredObservation[]> {
    const observations: StructuredObservation[] = [
      createFileObservation({
        document: context.document,
        indexRunId: context.indexRunId,
      }),
    ];

    for (const block of context.document.structuralBlocks ?? []) {
      const symbol = toGenericSymbolObservation({
        block,
        document: context.document,
        indexRunId: context.indexRunId,
      });
      if (symbol !== null) {
        observations.push(symbol);
      }
    }

    return Promise.resolve(dedupeObservations(observations));
  }
}

function toGenericSymbolObservation(options: {
  block: NonNullable<ParsedDocument["structuralBlocks"]>[number];
  document: ParsedDocument;
  indexRunId: string;
}): StructuredObservation | null {
  const symbolKind = normalizeSymbolKind(options.block.kind);
  if (symbolKind === null) {
    return null;
  }

  const name = inferName(options.block.content, symbolKind);
  if (name === null) {
    return null;
  }

  return {
    codeLocation: options.block.location,
    confidence: 0.7,
    contentHash: createHash("sha256").update(options.block.content).digest("hex"),
    evidenceId: createObservationId([
      options.document.path,
      "generic",
      symbolKind,
      name,
      options.block.location.startLine,
      options.block.location.endLine,
    ]),
    extractor: `generic-structural:${options.document.language ?? "unknown"}`,
    indexRunId: options.indexRunId,
    kind: "symbol_definition",
    language: options.document.language,
    metadata: {
      blockKind: options.block.kind,
    },
    name,
    path: options.document.path,
    sourceType: options.document.sourceType,
    symbolKind,
  };
}

function normalizeSymbolKind(kind: string): string | null {
  if (kind.includes("class")) {
    return "class";
  }
  if (kind.includes("interface")) {
    return "interface";
  }
  if (kind.includes("enum")) {
    return "enum";
  }
  if (kind.includes("type_alias") || kind === "type") {
    return "type";
  }
  if (kind.includes("function") || kind.includes("signature")) {
    return "function";
  }
  if (kind.includes("method")) {
    return "method";
  }
  if (kind.includes("variable") || kind.includes("lexical")) {
    return "variable";
  }

  return null;
}

function inferName(content: string, kind: string): string | null {
  const patterns = [
    /(?:export\s+default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/u,
    /(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
    /interface\s+([A-Za-z_$][\w$]*)/u,
    /enum\s+([A-Za-z_$][\w$]*)/u,
    /type\s+([A-Za-z_$][\w$]*)/u,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u,
    /([A-Za-z_$][\w$]*)\s*\(/u,
    /def\s+([A-Za-z_][\w]*)/u,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  return kind === "variable" ? firstLineSummary(content) : null;
}

function firstLineSummary(content: string): string {
  return content.split("\n", 1)[0]?.trim().slice(0, 120) ?? "unknown";
}

function dedupeObservations(
  observations: StructuredObservation[],
): StructuredObservation[] {
  const byId = new Map(observations.map((observation) => [observation.evidenceId, observation]));
  return Array.from(byId.values()).sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
}
