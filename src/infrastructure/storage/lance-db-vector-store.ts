import { connect, type Connection, type Table } from "@lancedb/lancedb";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { RetrievedChunk } from "../../application/dto/retrieval.js";
import type { PersistedChunkRecord } from "../../application/dto/storage.js";
import type { VectorStorePort } from "../../application/ports/vector-store-port.js";

type PersistedChunkRow = Omit<
  PersistedChunkRecord,
  "codeLocation" | "docLocation"
> & {
  _distance?: number;
  codeEndLine: number;
  codeStartLine: number;
  docOffset: number;
  docSection: string;
  hasCodeLocation: boolean;
  hasDocLocation: boolean;
};

export class LanceDbVectorStore implements VectorStorePort {
  private connectionPromise: Promise<Connection> | null = null;
  private tablePromise: Promise<Table> | null = null;

  constructor(
    private readonly options: {
      indexScope: string;
      projectIdentity: string;
      vectorDbUri: string;
    },
  ) {}

  async clear(): Promise<void> {
    const connection = await this.getConnection();
    const tableName = this.resolveTableName();
    const tableNames = await connection.tableNames();

    if (tableNames.includes(tableName)) {
      await connection.dropTable(tableName);
    }

    this.tablePromise = null;
  }

  async deleteByPath(path: string): Promise<void> {
    const table = await this.getExistingTable();
    if (table === null) {
      return;
    }

    await table.delete(`path = '${escapeSqlString(path)}'`);
  }

  async listRecords(): Promise<PersistedChunkRecord[]> {
    const table = await this.getExistingTable();
    if (table === null) {
      return [];
    }

    const rows = (await table.query().toArray()) as PersistedChunkRow[];
    return rows
      .map(toPersistedChunkRecord)
      .sort((left, right) => left.chunkKey.localeCompare(right.chunkKey));
  }

  async searchByEmbedding(
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievedChunk[]> {
    if (topK <= 0) {
      return [];
    }

    const table = await this.getExistingTable();
    if (table === null) {
      return [];
    }

    const rows = (await table
      .search(queryEmbedding)
      .limit(topK)
      .toArray()) as PersistedChunkRow[];
    return rows.map(
      (row) =>
        ({
          ...toPersistedChunkRecord(row),
          score: toRelevanceScore(row._distance),
        }) satisfies RetrievedChunk,
    );
  }

  async upsert(records: PersistedChunkRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const existingTable = await this.getExistingTable();
    if (existingTable === null) {
      await this.getOrCreateTable(records);
      return;
    }

    await existingTable
      .mergeInsert("chunkKey")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(records.map(toPersistedChunkRow));
  }

  private async getConnection(): Promise<Connection> {
    this.connectionPromise ??= this.createConnection();
    return this.connectionPromise;
  }

  private async createConnection(): Promise<Connection> {
    await mkdir(this.options.vectorDbUri, { recursive: true });
    return connect(this.options.vectorDbUri);
  }

  private async getExistingTable(): Promise<Table | null> {
    const connection = await this.getConnection();
    const tableName = this.resolveTableName();
    const tableNames = await connection.tableNames();

    if (!tableNames.includes(tableName)) {
      return null;
    }

    this.tablePromise ??= connection.openTable(tableName);
    return this.tablePromise;
  }

  private async getOrCreateTable(
    records: PersistedChunkRecord[],
  ): Promise<Table> {
    const existingTable = await this.getExistingTable();
    if (existingTable !== null) {
      return existingTable;
    }

    const connection = await this.getConnection();
    const tableName = this.resolveTableName();
    const rows = records.map(toPersistedChunkRow);
    this.tablePromise = connection.createTable(tableName, rows, {
      existOk: true,
      mode: "create",
    });

    return this.tablePromise;
  }

  private resolveTableName(): string {
    return resolve(this.options.projectIdentity, this.options.indexScope)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }
}

function toPersistedChunkRow(record: PersistedChunkRecord): PersistedChunkRow {
  return {
    chunkKey: record.chunkKey,
    content: record.content,
    contentHash: record.contentHash,
    embedding: record.embedding,
    evidenceId: record.evidenceId,
    extractor: record.extractor,
    fileFingerprint: record.fileFingerprint,
    indexRunId: record.indexRunId,
    path: record.path,
    sourceType: record.sourceType,
    codeEndLine: record.codeLocation?.endLine ?? 0,
    codeStartLine: record.codeLocation?.startLine ?? 0,
    docOffset: record.docLocation?.offset ?? 0,
    docSection: record.docLocation?.section ?? "",
    hasCodeLocation: record.codeLocation !== undefined,
    hasDocLocation: record.docLocation !== undefined,
  };
}

function toPersistedChunkRecord(row: PersistedChunkRow): PersistedChunkRecord {
  return {
    chunkKey: row.chunkKey,
    content: row.content,
    contentHash: row.contentHash,
    embedding: row.embedding,
    evidenceId: row.evidenceId,
    extractor: row.extractor,
    fileFingerprint: row.fileFingerprint,
    indexRunId: row.indexRunId,
    path: row.path,
    sourceType: row.sourceType,
    codeLocation: row.hasCodeLocation
      ? {
          endLine: row.codeEndLine,
          startLine: row.codeStartLine,
        }
      : undefined,
    docLocation: row.hasDocLocation
      ? {
          offset: row.docOffset > 0 ? row.docOffset : undefined,
          section: row.docSection.length > 0 ? row.docSection : undefined,
        }
      : undefined,
  };
}

function toRelevanceScore(distance: number | undefined): number {
  if (distance === undefined || Number.isNaN(distance) || distance < 0) {
    return 0;
  }

  return 1 / (1 + distance);
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}
