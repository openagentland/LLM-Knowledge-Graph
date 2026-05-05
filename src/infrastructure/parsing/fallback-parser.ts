import bash from "@ast-grep/lang-bash";
import c from "@ast-grep/lang-c";
import cpp from "@ast-grep/lang-cpp";
import csharp from "@ast-grep/lang-csharp";
import go from "@ast-grep/lang-go";
import java from "@ast-grep/lang-java";
import kotlin from "@ast-grep/lang-kotlin";
import php from "@ast-grep/lang-php";
import python from "@ast-grep/lang-python";
import ruby from "@ast-grep/lang-ruby";
import rust from "@ast-grep/lang-rust";
import scala from "@ast-grep/lang-scala";
import swift from "@ast-grep/lang-swift";
import { Lang, parse, registerDynamicLanguage } from "@ast-grep/napi";
import type { DynamicLangRegistrations, SgNode } from "@ast-grep/napi";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type {
  CodeLocation,
  DocLocation,
  DocumentPartition,
  ParsedDocument,
  ScanCandidate,
  StructuralCodeBlock,
} from "../../application/dto/ingestion.js";
import type { ParserPort } from "../../application/ports/parser-port.js";
import { ERROR_CODES, LkgError } from "../../shared/errors/lkg-error.js";

const dynamicLanguagesRegistered = registerLanguages();
const DEFAULT_PARTITION_MAX_CHARS = 8_000;
const LOCKFILE_PARTITION_MAX_CHARS = 2_000;

const STATIC_LANG_BY_EXTENSION: Record<string, Lang> = {
  js: Lang.JavaScript,
  ts: Lang.TypeScript,
};

const DECLARATION_KINDS = new Set([
  "abstract_class_declaration",
  "ambient_declaration",
  "class_declaration",
  "enum_declaration",
  "export_statement",
  "function_declaration",
  "function_signature",
  "generator_function_declaration",
  "import_statement",
  "interface_declaration",
  "lexical_declaration",
  "statement_block",
  "type_alias_declaration",
  "variable_declaration",
]);

export class FallbackParser implements ParserPort {
  async parse(candidate: ScanCandidate): Promise<ParsedDocument> {
    const content = await readFile(candidate.absolutePath, "utf8");
    const partitions = createPartitions(candidate, content);
    const settledDocuments = await Promise.all(
      partitions.map(async (partition) => {
        try {
          const document = await this.parsePartition(candidate, partition);
          return { document, partition, status: "fulfilled" as const };
        } catch {
          return { partition, status: "rejected" as const };
        }
      }),
    );
    const successfulDocuments = settledDocuments
      .filter(
        (
          result,
        ): result is Extract<PartitionParseResult, { status: "fulfilled" }> =>
          result.status === "fulfilled",
      )
      .map((result) => result.document);

    if (successfulDocuments.length === 0) {
      const degradedDocument = createDegradedDocument(
        candidate,
        content,
        partitions,
      );
      if (degradedDocument) {
        return degradedDocument;
      }

      throw new LkgError(
        ERROR_CODES.INTERNAL_ERROR,
        "Failed to parse all partitions for candidate.",
        {
          path: candidate.path,
        },
      );
    }

    const reconciledPartitions = reconcilePartitions(
      partitions,
      settledDocuments,
    );
    const structuralBlocks = successfulDocuments.flatMap(
      (document) => document.structuralBlocks ?? [],
    );

    const packageNameDocument = successfulDocuments.find(
      (document) => document.packageName !== undefined,
    );

    return {
      artifactKind: candidate.artifactKind,
      content,
      imports: successfulDocuments.flatMap(
        (document) => document.imports ?? [],
      ),
      language:
        successfulDocuments.find((document) => document.language !== null)
          ?.language ?? null,
      packageDependencies: successfulDocuments.flatMap(
        (document) => document.packageDependencies ?? [],
      ),
      packageName: packageNameDocument?.packageName,
      packageScripts: successfulDocuments.flatMap(
        (document) => document.packageScripts ?? [],
      ),
      partitions: reconciledPartitions,
      path: candidate.path,
      qualityGates: successfulDocuments.flatMap(
        (document) => document.qualityGates ?? [],
      ),
      sourceType: candidate.sourceType,
      structuralBlocks:
        structuralBlocks.length > 0 ? structuralBlocks : undefined,
      workflowSteps: successfulDocuments.flatMap(
        (document) => document.workflowSteps ?? [],
      ),
    };
  }

  parsePartition(
    candidate: ScanCandidate,
    partition: DocumentPartition,
  ): Promise<ParsedDocument> {
    const content = partition.content;
    const language = resolveLanguage(candidate.path);

    return Promise.resolve({
      artifactKind: candidate.artifactKind,
      content,
      imports: inferImports(candidate.path, content),
      language,
      packageDependencies: inferPackageDependencies(candidate.path, content),
      packageName: inferPackageName(candidate.path, content),
      packageScripts: inferPackageScripts(candidate.path, content),
      partitions: [partition],
      path: candidate.path,
      qualityGates: inferQualityGates(candidate.path, content),
      sourceType: candidate.sourceType,
      structuralBlocks:
        candidate.sourceType === "code"
          ? parseStructuralBlocks(language, content, partition.location)
          : undefined,
      workflowSteps: inferWorkflowSteps(candidate.path, content),
    });
  }
}

type PartitionParseResult =
  | {
      document: ParsedDocument;
      partition: DocumentPartition;
      status: "fulfilled";
    }
  | {
      partition: DocumentPartition;
      status: "rejected";
    };

function reconcilePartitions(
  partitions: DocumentPartition[],
  results: PartitionParseResult[],
): DocumentPartition[] {
  const byId = new Map(
    results.map((result) => [
      result.partition.partitionId,
      result.status === "fulfilled"
        ? (result.document.partitions?.[0]?.status ?? result.partition.status)
        : "failed",
    ]),
  );

  return partitions.map((partition) => ({
    ...partition,
    status: byId.get(partition.partitionId) ?? partition.status,
  }));
}

function createDegradedDocument(
  candidate: ScanCandidate,
  content: string,
  partitions: DocumentPartition[],
): ParsedDocument | null {
  if (!shouldCreateDegradedDocument(candidate)) {
    return null;
  }

  return {
    artifactKind: candidate.artifactKind,
    content,
    imports: inferImports(candidate.path, content),
    language: resolveLanguage(candidate.path),
    packageDependencies: inferPackageDependencies(candidate.path, content),
    packageName: inferPackageName(candidate.path, content),
    packageScripts: inferPackageScripts(candidate.path, content),
    partitions: partitions.map((partition) => ({
      ...partition,
      status: "degraded",
    })),
    path: candidate.path,
    qualityGates: inferQualityGates(candidate.path, content),
    sourceType: candidate.sourceType,
    structuralBlocks: undefined,
    workflowSteps: inferWorkflowSteps(candidate.path, content),
  };
}

function shouldCreateDegradedDocument(candidate: ScanCandidate): boolean {
  return candidate.artifactKind !== "lockfile";
}

function parseStructuralBlocks(
  language: string | null,
  content: string,
  partitionLocation?: CodeLocation | DocLocation,
): StructuralCodeBlock[] | undefined {
  if (language === null) {
    return undefined;
  }

  try {
    const astLanguage = STATIC_LANG_BY_EXTENSION[language] ?? language;
    const root = parse(astLanguage, content).root();
    const lineOffset = readCodeLocationStartLine(partitionLocation);
    const blocks = collectDeclarationBlocks(root)
      .map((node) => ({
        content: node.text().trim(),
        kind: String(node.kind()),
        location: {
          endLine: node.range().end.line + 1 + lineOffset,
          startLine: node.range().start.line + 1 + lineOffset,
        },
      }))
      .filter((block) => block.content.length > 0);

    if (blocks.length > 0) {
      return blocks;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readCodeLocationStartLine(
  location: CodeLocation | DocLocation | undefined,
): number {
  if (!location || !("startLine" in location)) {
    return 0;
  }

  return Math.max(0, location.startLine - 1);
}

function collectDeclarationBlocks(root: SgNode): SgNode[] {
  const blocks: SgNode[] = [];
  const queue = [...root.children()];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (DECLARATION_KINDS.has(String(node.kind()))) {
      blocks.push(node);
      continue;
    }

    queue.push(...node.children());
  }

  return blocks;
}

function registerLanguages(): boolean {
  try {
    registerDynamicLanguage({
      bash,
      c,
      cpp,
      csharp,
      go,
      java,
      kotlin,
      php,
      python,
      ruby,
      rust,
      scala,
      swift,
    } as unknown as DynamicLangRegistrations);
    return true;
  } catch {
    return false;
  }
}

function resolveLanguage(path: string): string | null {
  const extension = path.includes(".")
    ? path.slice(path.lastIndexOf(".") + 1).toLowerCase()
    : "";

  if (!extension) {
    return null;
  }

  if (!dynamicLanguagesRegistered) {
    return extension;
  }

  return extension;
}

function inferImports(path: string, content: string) {
  if (!/\.(?:[cm]?[jt]sx?|mts|cts)$/u.test(path)) {
    return [];
  }

  const matches = Array.from(
    content.matchAll(
      /(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/gu,
    ),
  );
  return matches.map((match) => ({
    isPackage: !match[1].startsWith("."),
    specifier: match[1],
  }));
}

function inferPackageName(path: string, content: string): string | undefined {
  if (basename(path) !== "package.json") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as { name?: string };
    return parsed.name;
  } catch {
    return undefined;
  }
}

function inferPackageDependencies(path: string, content: string) {
  if (basename(path) !== "package.json") {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return [
      ...Object.entries(parsed.dependencies ?? {}),
      ...Object.entries(parsed.devDependencies ?? {}),
      ...Object.entries(parsed.peerDependencies ?? {}),
    ].map(([name, version]) => ({ name, version }));
  } catch {
    return [];
  }
}

function inferPackageScripts(path: string, content: string) {
  if (basename(path) !== "package.json") {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({
      command,
      name,
    }));
  } catch {
    return [];
  }
}

function inferWorkflowSteps(path: string, content: string) {
  if (!path.startsWith(".github/workflows/") || !/\.ya?ml$/u.test(path)) {
    return [];
  }

  const lines = content.split("\n");
  const steps: Array<{ command?: string; name: string; scriptName?: string }> =
    [];
  let currentName: string | undefined;

  for (const line of lines) {
    const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/u);
    const name = nameMatch?.[1];
    if (name !== undefined) {
      currentName = name.trim();
      continue;
    }

    const runMatch = line.match(/^\s*run:\s*(.+)$/u);
    const commandValue = runMatch?.[1];
    if (commandValue !== undefined) {
      const command = commandValue.trim();
      const scriptMatch = command.match(/npm\s+run\s+([\w:-]+)/u);
      steps.push({
        command,
        name: currentName ?? command,
        scriptName: scriptMatch?.[1],
      });
      currentName = undefined;
    }
  }

  return steps;
}

function inferQualityGates(path: string, content: string) {
  if (basename(path) === "package.json") {
    return inferPackageScripts(path, content)
      .filter((script) => /(?:lint|test|typecheck|check)/u.test(script.name))
      .map((script) => ({
        command: script.command,
        scriptName: script.name,
        tool: "package-script",
      }));
  }

  if (path.startsWith(".github/workflows/") && /\.ya?ml$/u.test(path)) {
    return inferWorkflowSteps(path, content)
      .filter((step) => step.command !== undefined)
      .map((step) => ({
        command: step.command!,
        scriptName: step.scriptName,
        tool: "workflow-step",
      }));
  }

  return [];
}

function createPartitions(
  candidate: ScanCandidate,
  content: string,
): DocumentPartition[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const maxChars =
    candidate.artifactKind === "lockfile"
      ? LOCKFILE_PARTITION_MAX_CHARS
      : DEFAULT_PARTITION_MAX_CHARS;

  if (normalized.length <= maxChars) {
    return [
      {
        content: normalized,
        index: 0,
        location:
          candidate.sourceType === "code"
            ? { endLine: countLines(normalized), startLine: 1 }
            : { offset: 0 },
        partitionId: `${candidate.path}:0`,
        status: "complete",
        total: 1,
      },
    ];
  }

  const segments =
    candidate.sourceType === "code"
      ? splitCodePartitions(normalized, maxChars)
      : splitDocPartitions(normalized, maxChars);

  return segments.map((segment, index) => ({
    content: segment.content,
    index,
    location: segment.location,
    partitionId: `${candidate.path}:${index}`,
    status: index === 0 ? "partial" : "complete",
    total: segments.length,
  }));
}

function splitCodePartitions(
  content: string,
  maxChars: number,
): Array<{ content: string; location: CodeLocation }> {
  const lines = content.split("\n");
  const parts: Array<{ content: string; location: CodeLocation }> = [];
  let startIndex = 0;

  while (startIndex < lines.length) {
    let endIndex = startIndex;
    let currentLength = 0;

    while (endIndex < lines.length) {
      const nextLength = currentLength + lines[endIndex].length + 1;
      if (currentLength > 0 && nextLength > maxChars) {
        break;
      }
      currentLength = nextLength;
      endIndex += 1;
    }

    if (endIndex === startIndex) {
      endIndex = startIndex + 1;
    }

    parts.push({
      content: lines.slice(startIndex, endIndex).join("\n").trim(),
      location: {
        endLine: endIndex,
        startLine: startIndex + 1,
      },
    });

    startIndex = endIndex;
  }

  return parts.filter((part) => part.content.length > 0);
}

function splitDocPartitions(
  content: string,
  maxChars: number,
): Array<{ content: string; location: DocLocation }> {
  const sections = content
    .split(/\n(?=# )/g)
    .map((section) => section.trim())
    .filter(Boolean);
  const source = sections.length > 0 ? sections : [content.trim()];
  const parts: Array<{ content: string; location: DocLocation }> = [];

  for (const [index, section] of source.entries()) {
    if (section.length <= maxChars) {
      parts.push({
        content: section,
        location: { offset: index, section: readSectionTitle(section) },
      });
      continue;
    }

    let offset = 0;
    while (offset < section.length) {
      const slice = section.slice(offset, offset + maxChars).trim();
      if (slice) {
        parts.push({
          content: slice,
          location: {
            offset: parts.length,
            section: readSectionTitle(section),
          },
        });
      }
      offset += maxChars;
    }
  }

  return parts;
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  return content.split("\n").length;
}

function readSectionTitle(content: string): string | undefined {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}
