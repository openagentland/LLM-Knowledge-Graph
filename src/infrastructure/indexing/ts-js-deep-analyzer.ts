import { createHash } from "node:crypto";

import { createObservationId } from "./default-language-registry.js";
import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type { StructuredObservation } from "../../application/dto/structured-observations.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";

export class TsJsDeepAnalyzer implements StructuredAnalyzerPort {
  readonly id = "custom:ts-js";

  supports(document: ParsedDocument): boolean {
    return document.sourceType === "code" && (document.language === "ts" || document.language === "js");
  }

  analyze(context: {
    document: ParsedDocument;
    indexRunId: string;
  }): Promise<StructuredObservation[]> {
    const observations: StructuredObservation[] = [];
    const lines = context.document.content.split(/\r?\n/u);

    for (const [index, line] of lines.entries()) {
      const exported = line.match(
        /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/u,
      );
      if (exported?.[1] !== undefined) {
        observations.push(
          createObservation({
            document: context.document,
            indexRunId: context.indexRunId,
            kind: "symbol_export",
            line: index + 1,
            name: exported[1],
            symbolKind: inferExportKind(line),
            text: line,
          }),
        );
      }

      const method = line.match(/^\s*(?:public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*\(/u);
      if (method?.[1] !== undefined && !line.includes("function ")) {
        observations.push(
          createObservation({
            document: context.document,
            indexRunId: context.indexRunId,
            kind: "symbol_definition",
            line: index + 1,
            name: method[1],
            symbolKind: "method",
            text: line,
          }),
        );
      }
    }

    return Promise.resolve(dedupe(observations));
  }
}

function createObservation(options: {
  document: ParsedDocument;
  indexRunId: string;
  kind: StructuredObservation["kind"];
  line: number;
  name: string;
  symbolKind: string;
  text: string;
}): StructuredObservation {
  return {
    codeLocation: {
      endLine: options.line,
      startLine: options.line,
    },
    confidence: 0.85,
    contentHash: createHash("sha256").update(options.text).digest("hex"),
    evidenceId: createObservationId([
      options.document.path,
      options.kind,
      options.name,
      options.line,
      options.symbolKind,
      "ts-js-deep",
    ]),
    extractor: "custom:ts-js-deep",
    indexRunId: options.indexRunId,
    kind: options.kind,
    language: options.document.language,
    metadata: {
      analyzer: "ts-js-deep",
    },
    name: options.name,
    path: options.document.path,
    sourceType: options.document.sourceType,
    symbolKind: options.symbolKind,
  };
}

function inferExportKind(line: string): string {
  if (line.includes("function")) {
    return "function";
  }
  if (line.includes("class")) {
    return "class";
  }
  if (line.includes("interface")) {
    return "interface";
  }
  if (line.includes("type")) {
    return "type";
  }
  if (line.includes("enum")) {
    return "enum";
  }

  return "variable";
}

function dedupe(observations: StructuredObservation[]): StructuredObservation[] {
  return Array.from(new Map(observations.map((observation) => [observation.evidenceId, observation])).values()).sort(
    (left, right) => left.evidenceId.localeCompare(right.evidenceId),
  );
}
