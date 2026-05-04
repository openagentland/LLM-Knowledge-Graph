import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";
import type { StatusSnapshot } from "../dto/index-lifecycle.js";
import type {
  ListSymbolsCommand,
  ListSymbolsResult,
  SymbolSearchResult,
} from "../dto/symbols.js";
import type { IndexStatePort } from "../ports/index-state-port.js";
import type { SymbolCandidateStorePort } from "../ports/symbol-candidate-store-port.js";

export class ListSymbolsUseCase {
  constructor(
    private readonly indexStatePort: IndexStatePort,
    private readonly symbolCandidateStore: SymbolCandidateStorePort,
    private readonly context: {
      activeProjectIdentity: string;
      indexScope: StatusSnapshot["indexScope"];
    },
  ) {}

  async execute(command: ListSymbolsCommand): Promise<ListSymbolsResult> {
    const status = await this.indexStatePort.getStatus(
      this.context.activeProjectIdentity,
      this.context.indexScope,
    );

    if (
      status === null ||
      status.lastIndexedAt === null ||
      status.needsReindex ||
      status.state === "error"
    ) {
      throw new LkgError(
        ERROR_CODES.INDEX_NOT_READY,
        "The knowledge index is not ready for symbol queries.",
        {
          activeProjectIdentity: this.context.activeProjectIdentity,
          indexScope: this.context.indexScope,
          state: status?.state ?? null,
        },
      );
    }

    const query = command.query?.trim();
    if (command.query !== undefined && query === "") {
      throw new LkgError(
        ERROR_CODES.INVALID_INPUT,
        "Symbol query must not be empty.",
      );
    }

    const path = command.path?.trim();
    if (command.path !== undefined && path === "") {
      throw new LkgError(ERROR_CODES.INVALID_INPUT, "path must not be empty.");
    }

    const kind = command.kind?.trim();
    if (command.kind !== undefined && kind === "") {
      throw new LkgError(ERROR_CODES.INVALID_INPUT, "kind must not be empty.");
    }

    const normalizedQuery = query?.toLowerCase();
    const normalizedPath = path?.toLowerCase();
    const normalizedKind = kind?.toLowerCase();
    const records = await this.symbolCandidateStore.list({
      kind,
      path,
      sourceType: command.sourceType,
    });

    return {
      results: records
        .filter((record) => matchesQuery(record, normalizedQuery))
        .map((record) =>
          toSymbolSearchResult(record, {
            kind: normalizedKind,
            path: normalizedPath,
            query: normalizedQuery,
          }),
        )
        .sort(compareSymbolResults),
    };
  }
}

function matchesQuery(
  record: Awaited<ReturnType<SymbolCandidateStorePort["list"]>>[number],
  query: string | undefined,
): boolean {
  if (query === undefined) {
    return true;
  }

  return [record.name, record.containerName, record.signature, record.kind]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

function toSymbolSearchResult(
  record: Awaited<ReturnType<SymbolCandidateStorePort["list"]>>[number],
  criteria: {
    kind: string | undefined;
    path: string | undefined;
    query: string | undefined;
  },
): SymbolSearchResult {
  const exactNameMatch =
    criteria.query !== undefined && record.name.toLowerCase() === criteria.query;
  const exactPathMatch =
    criteria.path !== undefined && record.path.toLowerCase() === criteria.path;
  const kindMatch =
    criteria.kind !== undefined && record.kind.toLowerCase() === criteria.kind;
  const confidence = inferConfidence(record);

  return {
    confidence,
    containerName: record.containerName,
    evidence: {
      codeLocation: record.codeLocation,
      contentHash: record.contentHash,
      evidenceId: record.evidenceId,
      extractor: record.extractor,
      path: record.path,
    },
    indexRunId: record.indexRunId,
    kind: record.kind,
    language: record.language,
    name: record.name,
    ranking: {
      exactNameMatch,
      exactPathMatch,
      kindMatch,
      score:
        (exactNameMatch ? 1_000 : 0) +
        (exactPathMatch ? 100 : 0) +
        (kindMatch ? 10 : 0) +
        confidence,
    },
    scope: record.scope,
    signature: record.signature,
    sourceType: record.sourceType,
  };
}

function inferConfidence(
  record: Awaited<ReturnType<SymbolCandidateStorePort["list"]>>[number],
): number {
  const confidence = (record as Record<string, unknown>).confidence;
  if (typeof confidence === "number") {
    return confidence;
  }

  return record.signature !== undefined ? 0.95 : 0.75;
}

function compareSymbolResults(
  left: SymbolSearchResult,
  right: SymbolSearchResult,
): number {
  return (
    (right.ranking?.score ?? 0) - (left.ranking?.score ?? 0) ||
    (right.confidence ?? 0) - (left.confidence ?? 0) ||
    left.evidence.path.localeCompare(right.evidence.path) ||
    left.evidence.codeLocation.startLine - right.evidence.codeLocation.startLine ||
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name)
  );
}
