import { createHash } from "node:crypto";

import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type {
  AnalyzerEngine,
  LanguageCapability,
  PersistedStructuredObservationRecord,
  StructuredObservation,
  StructuredObservationKind,
} from "../../application/dto/structured-observations.js";
import type { LanguageRegistryPort } from "../../application/ports/language-registry-port.js";

const AST_GREP_LANGUAGES = new Map<string, { aliases: string[]; extensions: string[] }>([
  ["js", { aliases: ["javascript"], extensions: ["js", "jsx", "cjs", "mjs"] }],
  ["ts", { aliases: ["typescript"], extensions: ["ts", "tsx", "mts", "cts"] }],
  ["py", { aliases: ["python"], extensions: ["py"] }],
  ["go", { aliases: [], extensions: ["go"] }],
  ["java", { aliases: [], extensions: ["java"] }],
  ["rb", { aliases: ["ruby"], extensions: ["rb"] }],
  ["rs", { aliases: ["rust"], extensions: ["rs"] }],
  ["php", { aliases: [], extensions: ["php"] }],
  ["kt", { aliases: ["kotlin"], extensions: ["kt", "kts"] }],
  ["swift", { aliases: [], extensions: ["swift"] }],
  ["scala", { aliases: [], extensions: ["scala"] }],
  ["cs", { aliases: ["csharp"], extensions: ["cs"] }],
  ["c", { aliases: [], extensions: ["c", "h"] }],
  ["cpp", { aliases: ["cxx"], extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"] }],
  ["sh", { aliases: ["bash"], extensions: ["sh", "bash"] }],
]);

const ARTIFACT_CAPABILITIES: LanguageCapability[] = [
  {
    analyzerEngines: ["custom" satisfies AnalyzerEngine],
    artifactKinds: ["package", "workspace", "task"],
    capabilities: ["config", "task"],
    extensions: ["json"],
    fallbackStrategy: "text-only",
    id: "package-json",
    observationKinds: ["config_artifact", "task"],
    supportLevel: "full",
  },
  {
    analyzerEngines: ["custom" satisfies AnalyzerEngine],
    artifactKinds: ["workspace", "config"],
    capabilities: ["config", "task"],
    extensions: ["json"],
    fallbackStrategy: "text-only",
    id: "nx-json",
    observationKinds: ["config_artifact", "task"],
    supportLevel: "partial",
  },
  {
    analyzerEngines: ["custom" satisfies AnalyzerEngine],
    artifactKinds: ["workflow"],
    capabilities: ["workflow", "task", "config"],
    extensions: ["yml", "yaml"],
    fallbackStrategy: "text-only",
    id: "github-workflow",
    observationKinds: ["workflow", "workflow_job", "workflow_step", "task"],
    supportLevel: "partial",
  },
  {
    analyzerEngines: ["custom" satisfies AnalyzerEngine],
    artifactKinds: ["config"],
    capabilities: ["config"],
    extensions: ["json", "mjs", "js", "sh"],
    fallbackStrategy: "text-only",
    id: "repo-config",
    observationKinds: ["config_artifact", "quality_gate", "task"],
    supportLevel: "partial",
  },
];

const DEFAULT_CODE_OBSERVATION_KINDS: StructuredObservationKind[] = [
  "file",
  "module",
  "symbol_definition",
  "symbol_export",
  "import",
  "call",
  "reference",
];

export class DefaultLanguageRegistry implements LanguageRegistryPort {
  private readonly capabilities: LanguageCapability[];

  constructor() {
    const codeCapabilities: LanguageCapability[] = Array.from(
      AST_GREP_LANGUAGES.entries(),
    ).map(([id, definition]) => ({
      analyzerEngines: ["ast-grep", "custom"],
      artifactKinds: ["code"],
      capabilities: [
        "definition",
        "export",
        "import",
        "reference",
        "call",
        "module",
      ],
      extensions: definition.extensions,
      fallbackStrategy: "generic-structural",
      id,
      observationKinds: DEFAULT_CODE_OBSERVATION_KINDS,
      supportLevel: "partial",
    }));

    this.capabilities = [...codeCapabilities, ...ARTIFACT_CAPABILITIES];
  }

  detect(path: string): LanguageCapability | null {
    const extension = getExtension(path);
    if (extension === null) {
      return null;
    }

    return (
      this.capabilities.find(
        (capability) =>
          capability.artifactKinds?.includes("code") === true &&
          capability.extensions.includes(extension),
      ) ?? null
    );
  }

  detectArtifact(path: string): LanguageCapability | null {
    if (path === "package.json") {
      return this.capabilities.find((capability) => capability.id === "package-json") ?? null;
    }
    if (path === "nx.json") {
      return this.capabilities.find((capability) => capability.id === "nx-json") ?? null;
    }
    if (path.startsWith(".github/workflows/") && /\.ya?ml$/u.test(path)) {
      return this.capabilities.find((capability) => capability.id === "github-workflow") ?? null;
    }
    if (
      path === ".devcontainer/devcontainer.json" ||
      path === "eslint.config.mjs" ||
      path === "commitlint.config.js" ||
      path === ".lintstagedrc.json" ||
      path.startsWith(".husky/")
    ) {
      return this.capabilities.find((capability) => capability.id === "repo-config") ?? null;
    }

    return null;
  }

  list(): LanguageCapability[] {
    return [...this.capabilities];
  }
}

export function toStructuredObservationRecord(options: {
  fileFingerprint: string;
  observation: StructuredObservation;
}): PersistedStructuredObservationRecord {
  return {
    ...options.observation,
    fileFingerprint: options.fileFingerprint,
  };
}

export function createObservationId(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join(":"))
    .digest("hex");
}

export function createFileObservation(options: {
  document: ParsedDocument;
  indexRunId: string;
}): StructuredObservation {
  return {
    confidence: 1,
    contentHash: createHash("sha256").update(options.document.content).digest("hex"),
    evidenceId: createObservationId([
      options.document.path,
      options.indexRunId,
      "file",
      options.document.language,
    ]),
    extractor: "structured:file",
    indexRunId: options.indexRunId,
    kind: "file",
    language: options.document.language,
    metadata: {
      bytes: Buffer.byteLength(options.document.content, "utf8"),
      lineCount: countLines(options.document.content),
    },
    path: options.document.path,
    sourceType: options.document.sourceType,
  };
}

function getExtension(path: string): string | null {
  const lastDot = path.lastIndexOf(".");
  if (lastDot < 0 || lastDot === path.length - 1) {
    return null;
  }

  return path.slice(lastDot + 1).toLowerCase();
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/u).length;
}
