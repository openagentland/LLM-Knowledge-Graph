import { Lang, parse } from "@ast-grep/napi";
import { createHash } from "node:crypto";

import type {
  AstGrepRuleDefinition,
  AstGrepRuleLoader,
} from "./ast-grep-rule-loader.js";
import {
  createFileObservation,
  createObservationId,
} from "./default-language-registry.js";
import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type { StructuredObservation } from "../../application/dto/structured-observations.js";
import type { LanguageRegistryPort } from "../../application/ports/language-registry-port.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";

export class AstGrepStructuredAnalyzer implements StructuredAnalyzerPort {
  readonly id = "ast-grep";

  constructor(
    private readonly languageRegistry: LanguageRegistryPort,
    private readonly ruleLoader: AstGrepRuleLoader,
  ) {}

  supports(document: ParsedDocument): boolean {
    return (
      document.sourceType === "code" &&
      document.language !== null &&
      this.languageRegistry.detect(document.path) !== null
    );
  }

  async analyze(context: {
    document: ParsedDocument;
    indexRunId: string;
  }): Promise<StructuredObservation[]> {
    const capability = this.languageRegistry.detect(context.document.path);
    const ruleSet = await this.ruleLoader.load(capability);

    if (capability === null || ruleSet === null || context.document.language === null) {
      return [];
    }

    const parseLanguage = resolveParseLanguage(context.document.language);
    if (parseLanguage === null) {
      return [];
    }

    const root = parse(parseLanguage, context.document.content).root();
    const observations: StructuredObservation[] = [
      createFileObservation({
        document: context.document,
        indexRunId: context.indexRunId,
      }),
    ];

    const rootKind = String(root.kind());
    if (ruleSet.moduleMatchers?.includes(rootKind) === true) {
      observations.push(
        createObservation({
          confidence: 0.95,
          document: context.document,
          indexRunId: context.indexRunId,
          kind: "module",
          metadata: {
            rootKind: String(root.kind()),
          },
          nodeText: context.document.content,
          path: context.document.path,
          ruleId: `${capability.id}.module`,
          startLine: 1,
          endLine: Math.max(1, context.document.content.split(/\r?\n/u).length),
        }),
      );
    }

    for (const rule of ruleSet.rules) {
      for (const node of root.findAll(rule.matcher)) {
        const nodeText = node.text().trim();
        if (nodeText.length === 0) {
          continue;
        }

        observations.push(
          createObservation({
            confidence: rule.confidence ?? 0.5,
            document: context.document,
            indexRunId: context.indexRunId,
            kind: rule.kind,
            metadata: {
              ruleId: rule.id,
            },
            name: inferName(nodeText, rule),
            nodeText,
            path: context.document.path,
            ruleId: rule.id,
            startLine: node.range().start.line + 1,
            endLine: node.range().end.line + 1,
            symbolKind: rule.symbolKind,
          }),
        );
      }
    }

    return dedupeObservations(observations);
  }
}

function createObservation(options: {
  confidence: number;
  document: ParsedDocument;
  endLine: number;
  indexRunId: string;
  kind: StructuredObservation["kind"];
  metadata?: Record<string, string | number | boolean | null | undefined>;
  name?: string;
  nodeText: string;
  path: string;
  ruleId: string;
  startLine: number;
  symbolKind?: string;
}): StructuredObservation {
  return {
    codeLocation: {
      endLine: options.endLine,
      startLine: options.startLine,
    },
    confidence: options.confidence,
    contentHash: createHash("sha256").update(options.nodeText).digest("hex"),
    evidenceId: createObservationId([
      options.path,
      options.kind,
      options.name,
      options.startLine,
      options.endLine,
      options.ruleId,
    ]),
    extractor: `ast-grep:${options.ruleId}`,
    indexRunId: options.indexRunId,
    kind: options.kind,
    language: options.document.language,
    metadata: options.metadata,
    name: options.name,
    path: options.path,
    sourceType: options.document.sourceType,
    symbolKind: options.symbolKind,
  };
}

function inferName(
  text: string,
  rule: AstGrepRuleDefinition,
): string | undefined {
  if (rule.kind === "call") {
    const match = text.match(/([A-Za-z_$][\w$]*)\s*\(/u);
    return match?.[1];
  }

  if (rule.kind === "import") {
    const fromMatch = text.match(/from\s+["']([^"']+)["']/u);
    const importMatch = text.match(/import\s+([^\n;]+)/u);
    return fromMatch?.[1] ?? importMatch?.[1]?.trim();
  }

  const patterns = [
    /(?:export\s+default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/u,
    /(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
    /interface\s+([A-Za-z_$][\w$]*)/u,
    /enum\s+([A-Za-z_$][\w$]*)/u,
    /type\s+([A-Za-z_$][\w$]*)/u,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u,
    /def\s+([A-Za-z_][\w]*)/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match?.[1];
    if (name !== undefined) {
      return name;
    }
  }

  return rule.kind === "reference" ? text : undefined;
}

function resolveParseLanguage(language: string): Lang | string | null {
  switch (language) {
    case "js":
      return Lang.JavaScript;
    case "ts":
      return Lang.TypeScript;
    default:
      return language.length > 0 ? language : null;
  }
}

function dedupeObservations(
  observations: StructuredObservation[],
): StructuredObservation[] {
  const seen = new Set<string>();
  const deduped: StructuredObservation[] = [];

  for (const observation of observations) {
    const key = observation.evidenceId;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(observation);
  }

  return deduped;
}
