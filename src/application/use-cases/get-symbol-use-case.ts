import { ListSymbolsUseCase } from "./list-symbols-use-case.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type {
  GetSymbolCommand,
  SymbolContextResult,
  SymbolDetailResult,
  SymbolRelationResult,
  SymbolSearchResult,
} from "../dto/symbols.js";
import type { CanonicalFactStorePort } from "../ports/canonical-fact-store-port.js";
import type { DerivedFactStorePort } from "../ports/derived-fact-store-port.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { InternalGraphStorePort } from "../ports/internal-graph-store-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

export class GetSymbolUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly canonicalFactStore: CanonicalFactStorePort,
    private readonly derivedFactStore: DerivedFactStorePort,
    private readonly internalGraphStore: InternalGraphStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(command: GetSymbolCommand): Promise<SymbolDetailResult> {
    const path = command.path.trim();
    if (!path) {
      throw new LkgError(ERROR_CODES.INVALID_INPUT, "path must not be empty.");
    }

    const symbol = command.symbol.trim();
    if (!symbol) {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "symbol must not be empty.",
      );
    }

    const listUseCase = new ListSymbolsUseCase(
      this.indexStatePort,
      this.symbolCandidateStore,
      this.context,
    );
    const result = await listUseCase.execute({ path, query: symbol });
    const exactMatches = result.results.filter(
      (candidate) => candidate.name === symbol,
    );

    if (exactMatches.length === 0) {
      throw new LkgError(
        ERROR_CODES.SYMBOL_NOT_FOUND,
        `Symbol not found: ${symbol}`,
        { path, symbol },
      );
    }

    if (
      exactMatches.length > 1 &&
      haveEquivalentTopRank(exactMatches[0], exactMatches[1])
    ) {
      throw new LkgError(
        ERROR_CODES.AMBIGUOUS_SYMBOL,
        `Symbol is ambiguous: ${symbol}`,
        {
          candidates: exactMatches.map(toAmbiguousCandidate),
          path,
          symbol,
        },
      );
    }

    const winner = exactMatches[0];
    const [canonicalFacts, derivedFacts, graph] = await Promise.all([
      this.canonicalFactStore.list({ path }),
      this.derivedFactStore.list({ path }),
      this.internalGraphStore.listByPath(path),
    ]);

    return {
      callers: toRelations(derivedFacts, winner, "caller-callee-candidate", "fromId"),
      callees: toRelations(derivedFacts, winner, "caller-callee-candidate", "toId"),
      candidates: exactMatches,
      exports: toContexts(canonicalFacts, winner, "symbol_export", "exportedName"),
      imports: toContexts(canonicalFacts, winner, "file_import", "specifier"),
      references: toContexts(
        derivedFacts,
        winner,
        "symbol-references-symbol-candidate",
        "toId",
      ),
      repoContext: [
        ...toContexts(canonicalFacts, winner, "workspace_task", "taskName"),
        ...toContexts(canonicalFacts, winner, "package_script", "scriptName"),
      ],
      symbol: {
        ...winner,
        confidence: Math.max(
          winner.confidence ?? 0,
          ...canonicalFacts
            .filter((fact) => fact.kind === "symbol_definition")
            .filter((fact) => fact.payload.name === winner.name)
            .map((fact) => fact.confidence),
        ),
      },
      tests: toGraphContexts(graph, winner),
    };
  }
}

function haveEquivalentTopRank(
  left: SymbolSearchResult | undefined,
  right: SymbolSearchResult | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return (
    (left.ranking?.score ?? 0) === (right.ranking?.score ?? 0) &&
    (left.confidence ?? 0) === (right.confidence ?? 0)
  );
}

function toAmbiguousCandidate(candidate: SymbolSearchResult) {
  return {
    confidence: candidate.confidence,
    containerName: candidate.containerName,
    evidence: candidate.evidence,
    indexRunId: candidate.indexRunId,
    kind: candidate.kind,
    language: candidate.language,
    name: candidate.name,
    ranking: candidate.ranking,
    scope: candidate.scope,
    signature: candidate.signature,
    sourceType: candidate.sourceType,
  };
}

function toRelations(
  facts: Array<{
    confidence: number;
    contentHash: string;
    evidenceId: string;
    extractor: string;
    indexRunId: string;
    kind: string;
    path: string;
    payload: Record<string, unknown>;
    sourceType: SymbolSearchResult["sourceType"];
  }>,
  symbol: SymbolSearchResult,
  kind: string,
  payloadKey: string,
): SymbolRelationResult[] {
  return facts
    .filter((fact) => fact.kind === kind)
    .filter((fact) => fact.payload[payloadKey] === symbol.evidence.evidenceId)
    .map((fact) => ({
      confidence: fact.confidence,
      evidence: {
        codeLocation: symbol.evidence.codeLocation,
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        path: fact.path,
      },
      indexRunId: fact.indexRunId,
      kind: symbol.kind,
      language: symbol.language,
      name: symbol.name,
      relationshipKind: fact.kind,
      scope: symbol.scope,
      signature: symbol.signature,
      sourceType: fact.sourceType,
    }));
}

function toContexts(
  facts: Array<{
    confidence: number;
    contentHash: string;
    evidenceId: string;
    extractor: string;
    indexRunId: string;
    kind: string;
    path: string;
    payload: Record<string, unknown>;
    sourceType: SymbolSearchResult["sourceType"];
  }>,
  symbol: SymbolSearchResult,
  kind: string,
  payloadKey: string,
): SymbolContextResult[] {
  return facts
    .filter((fact) => fact.kind === kind)
    .filter((fact) => Object.values(fact.payload).includes(symbol.name))
    .map((fact) => ({
      confidence: fact.confidence,
      containerName: symbol.containerName,
      evidence: {
        codeLocation: symbol.evidence.codeLocation,
        contentHash: fact.contentHash,
        evidenceId: fact.evidenceId,
        extractor: fact.extractor,
        path: fact.path,
      },
      indexRunId: fact.indexRunId,
      kind: symbol.kind,
      label:
        typeof fact.payload[payloadKey] === "string"
          ? fact.payload[payloadKey]
          : fact.kind,
      language: symbol.language,
      name: symbol.name,
      ranking: symbol.ranking,
      scope: symbol.scope,
      signature: symbol.signature,
      sourceType: fact.sourceType,
    }));
}

function toGraphContexts(
  graph: Awaited<ReturnType<InternalGraphStorePort["listByPath"]>>,
  symbol: SymbolSearchResult,
): SymbolContextResult[] {
  return graph.nodes
    .filter((node) => node.kind === "Symbol" || node.kind === "Task")
    .filter((node) => Object.values(node.properties).includes(symbol.name))
    .map((node) => ({
      confidence: node.confidence,
      containerName: symbol.containerName,
      evidence: {
        codeLocation: node.codeLocation ?? symbol.evidence.codeLocation,
        contentHash: node.contentHash,
        evidenceId: node.evidenceId,
        extractor: node.extractor,
        path: node.path,
      },
      indexRunId: node.indexRunId,
      kind: symbol.kind,
      label:
        typeof node.properties.label === "string"
          ? node.properties.label
          : node.kind,
      language: symbol.language,
      name: symbol.name,
      ranking: symbol.ranking,
      scope: symbol.scope,
      signature: symbol.signature,
      sourceType: node.sourceType,
    }));
}
