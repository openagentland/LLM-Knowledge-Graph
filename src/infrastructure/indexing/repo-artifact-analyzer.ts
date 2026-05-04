import { createHash } from "node:crypto";

import { createObservationId } from "./default-language-registry.js";
import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type { StructuredObservation } from "../../application/dto/structured-observations.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";

export class RepoArtifactAnalyzer implements StructuredAnalyzerPort {
  readonly id = "artifact:repo-config";

  supports(document: ParsedDocument): boolean {
    return isArtifactPath(document.path);
  }

  analyze(context: {
    document: ParsedDocument;
    indexRunId: string;
  }): Promise<StructuredObservation[]> {
    if (context.document.path === "package.json") {
      return Promise.resolve(analyzePackageJson(context.document, context.indexRunId));
    }
    if (context.document.path === "nx.json") {
      return Promise.resolve(analyzeNxConfig(context.document, context.indexRunId));
    }
    if (context.document.path.startsWith(".github/workflows/")) {
      return Promise.resolve(analyzeWorkflow(context.document, context.indexRunId));
    }

    return Promise.resolve([
      createArtifactObservation({
        document: context.document,
        indexRunId: context.indexRunId,
        kind: "config_artifact",
        name: context.document.path,
        symbolKind: "config",
        text: context.document.content,
      }),
    ]);
  }
}

function isArtifactPath(path: string): boolean {
  return (
    path === "package.json" ||
    path === "nx.json" ||
    path === ".devcontainer/devcontainer.json" ||
    path === "eslint.config.mjs" ||
    path === "commitlint.config.js" ||
    path === ".lintstagedrc.json" ||
    path.startsWith(".github/workflows/") ||
    path.startsWith(".husky/")
  );
}

function analyzePackageJson(document: ParsedDocument, indexRunId: string): StructuredObservation[] {
  const observations: StructuredObservation[] = [
    createArtifactObservation({
      document,
      indexRunId,
      kind: "config_artifact",
      name: document.packageName ?? "package.json",
      symbolKind: "package",
      text: document.content,
    }),
  ];

  for (const script of document.packageScripts ?? []) {
    observations.push(
      createArtifactObservation({
        document,
        indexRunId,
        kind: "task",
        metadata: { command: script.command, scriptName: script.name },
        name: script.name,
        symbolKind: "package-script",
        text: script.command,
      }),
    );
  }

  return observations;
}

function analyzeNxConfig(document: ParsedDocument, indexRunId: string): StructuredObservation[] {
  return [
    createArtifactObservation({
      document,
      indexRunId,
      kind: "config_artifact",
      name: "nx",
      symbolKind: "workspace",
      text: document.content,
    }),
  ];
}

function analyzeWorkflow(document: ParsedDocument, indexRunId: string): StructuredObservation[] {
  const observations: StructuredObservation[] = [
    createArtifactObservation({
      document,
      indexRunId,
      kind: "workflow",
      name: document.path,
      symbolKind: "workflow",
      text: document.content,
    }),
  ];

  for (const step of document.workflowSteps ?? []) {
    observations.push(
      createArtifactObservation({
        document,
        indexRunId,
        kind: "workflow_step",
        metadata: { command: step.command, scriptName: step.scriptName },
        name: step.name,
        symbolKind: "workflow-step",
        text: `${step.name}:${step.command ?? ""}`,
      }),
    );
  }

  for (const gate of document.qualityGates ?? []) {
    observations.push(
      createArtifactObservation({
        document,
        indexRunId,
        kind: "quality_gate",
        metadata: { command: gate.command, scriptName: gate.scriptName, tool: gate.tool },
        name: gate.tool,
        symbolKind: "quality-gate",
        text: `${gate.tool}:${gate.command}`,
      }),
    );
  }

  return observations;
}

function createArtifactObservation(options: {
  document: ParsedDocument;
  indexRunId: string;
  kind: StructuredObservation["kind"];
  metadata?: Record<string, string | number | boolean | null | undefined>;
  name: string;
  symbolKind: string;
  text: string;
}): StructuredObservation {
  return {
    confidence: 0.9,
    contentHash: createHash("sha256").update(options.text).digest("hex"),
    evidenceId: createObservationId([
      options.document.path,
      options.kind,
      options.name,
      options.symbolKind,
    ]),
    extractor: "artifact:repo-config",
    indexRunId: options.indexRunId,
    kind: options.kind,
    language: options.document.language,
    metadata: options.metadata,
    name: options.name,
    path: options.document.path,
    sourceType: options.document.sourceType,
    symbolKind: options.symbolKind,
  };
}
