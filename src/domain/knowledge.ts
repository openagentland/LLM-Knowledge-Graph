export type SourceType = "code" | "doc";

export type CodeLocation = {
  endLine: number;
  startLine: number;
};

export type StructuredDataScope = "file";

export type StructuredObservationKind =
  | "file"
  | "module"
  | "symbol_definition"
  | "symbol_export"
  | "import"
  | "call"
  | "reference"
  | "workflow"
  | "workflow_job"
  | "workflow_step"
  | "quality_gate"
  | "config_artifact"
  | "task";

export type CanonicalFactKind =
  | "symbol_candidate"
  | "symbol_definition"
  | "symbol_export"
  | "file_import"
  | "package_dependency"
  | "package_script"
  | "workspace_task"
  | "config_artifact"
  | "workflow"
  | "workflow_job"
  | "workflow_step"
  | "quality_gate";

export type DerivedFactKind =
  | "symbol-defined-in-file"
  | "symbol-exported-from-file"
  | "file-imports-file"
  | "file-imports-package"
  | "package-depends-on-package"
  | "symbol-references-symbol-candidate"
  | "caller-callee-candidate"
  | "workflow-runs-package-script-candidate"
  | "workflow-contains-job"
  | "job-runs-step"
  | "quality-gate-runs-command"
  | "quality-gate-runs-script-candidate"
  | "task-runs-command";

export type StructuredDataProvenance = {
  codeLocation?: CodeLocation;
  contentHash: string;
  evidenceId: string;
  extractor: string;
  path: string;
};

export type SymbolIdentity = {
  kind: string;
  name: string;
};

export type SymbolCandidateRecord = StructuredDataProvenance &
  Required<Pick<StructuredDataProvenance, "codeLocation">> & {
    containerName?: string;
    fileFingerprint: string;
    indexRunId: string;
    kind: string;
    language: string | null;
    name: string;
    path: string;
    scope: StructuredDataScope;
    signature?: string;
    sourceType: SourceType;
  };

export type CanonicalFactRecord = StructuredDataProvenance & {
  confidence: number;
  factId: string;
  fileFingerprint: string;
  indexRunId: string;
  kind: CanonicalFactKind;
  layer: "canonical";
  payload: Record<string, unknown>;
  path: string;
  sourceType: SourceType;
};

export type DerivedFactRecord = StructuredDataProvenance & {
  confidence: number;
  derivedFactId: string;
  fileFingerprint: string;
  indexRunId: string;
  kind: DerivedFactKind;
  layer: "derived";
  payload: Record<string, unknown>;
  path: string;
  sourceType: SourceType;
};

export type InternalGraphNodeRecord = StructuredDataProvenance & {
  confidence: number;
  indexRunId: string;
  kind: string;
  layer: "graph";
  nodeId: string;
  path: string;
  properties: Record<string, unknown>;
  sourceType: SourceType;
};

export type InternalGraphEdgeRecord = StructuredDataProvenance & {
  confidence: number;
  edgeId: string;
  fromNodeId: string;
  indexRunId: string;
  kind: string;
  layer: "graph";
  path: string;
  properties: Record<string, unknown>;
  sourceType: SourceType;
  toNodeId: string;
};

export type CanonicalDescriptor = {
  id: string;
  kind: string;
  label: string;
};

export function normalizeSymbolKind(kind: string): string {
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
  if (kind.includes("variable") || kind.includes("lexical")) {
    return "variable";
  }
  if (kind.includes("import")) {
    return "import";
  }
  if (kind.includes("export")) {
    return "export";
  }
  if (kind.includes("statement_block")) {
    return "block";
  }
  return kind.replace(/_declaration$/u, "");
}

export function inferSymbolIdentity(options: {
  content: string;
  kind: string;
  language: string | null;
}): SymbolIdentity | null {
  const normalizedKind = normalizeSymbolKind(options.kind);

  if (options.language === "ts" || options.language === "js") {
    return inferTsJsSymbolIdentity(options.content, normalizedKind);
  }

  const genericName = inferGenericName(options.content, normalizedKind);
  if (genericName === null) {
    return null;
  }

  return {
    kind: normalizedKind,
    name: genericName,
  };
}

function inferTsJsSymbolIdentity(
  content: string,
  fallbackKind: string,
): SymbolIdentity | null {
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    { kind: "class", regex: /(?:export\s+default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "interface", regex: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "enum", regex: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", regex: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /(?:export\s+default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/ },
    { kind: "function", regex: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { kind: "function", regex: /(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
    { kind: "variable", regex: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern.regex);
    if (match?.[1] !== undefined) {
      return {
        kind: pattern.kind,
        name: match[1],
      };
    }
  }

  const genericName = inferGenericName(content, fallbackKind);
  if (genericName === null) {
    return null;
  }

  return {
    kind: fallbackKind,
    name: genericName,
  };
}

function inferGenericName(content: string, kind: string): string | null {
  const patterns = [
    /(?:class|interface|enum|type|trait|struct)\s+([A-Za-z_$][\w$]*)/,
    /(?:function|func|def)\s+([A-Za-z_$][\w$]*)/,
    /(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/,
    /^([A-Za-z_$][\w$]*)\s*[:=(<{]/m,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  if (kind === "block") {
    return null;
  }

  return firstLineSummary(content);
}

function firstLineSummary(content: string): string {
  return content.split("\n", 1)[0]?.trim().slice(0, 120) ?? "unknown";
}

export function getCanonicalDescriptor(
  fact: CanonicalFactRecord,
): CanonicalDescriptor | null {
  switch (fact.kind) {
    case "symbol_definition": {
      const name = asString(fact.payload.name);
      if (name === undefined) return null;
      return { id: name, kind: "Symbol", label: name };
    }
    case "symbol_export": {
      const name = asString(fact.payload.exportedName);
      if (name === undefined) return null;
      return { id: name, kind: "Symbol", label: name };
    }
    case "file_import": {
      const specifier = asString(fact.payload.specifier);
      if (specifier === undefined) return null;
      const kind = fact.payload.isPackage === true ? "Package" : "File";
      return { id: specifier, kind, label: specifier };
    }
    case "package_dependency": {
      const dependencyName = asString(fact.payload.dependencyName);
      if (dependencyName === undefined) return null;
      return { id: dependencyName, kind: "Package", label: dependencyName };
    }
    case "package_script": {
      const scriptName = asString(fact.payload.scriptName);
      if (scriptName === undefined) return null;
      return { id: scriptName, kind: "PackageScript", label: scriptName };
    }
    case "workspace_task": {
      const taskName = asString(fact.payload.taskName);
      if (taskName === undefined) return null;
      return { id: taskName, kind: "Task", label: taskName };
    }
    case "config_artifact": {
      const artifactName = asString(fact.payload.artifactName);
      if (artifactName === undefined) return null;
      return { id: artifactName, kind: "ConfigArtifact", label: artifactName };
    }
    case "workflow": {
      const workflowName = asString(fact.payload.workflowName);
      if (workflowName === undefined) return null;
      return { id: workflowName, kind: "Workflow", label: workflowName };
    }
    case "workflow_job": {
      const jobName = asString(fact.payload.jobName);
      if (jobName === undefined) return null;
      return { id: jobName, kind: "WorkflowJob", label: jobName };
    }
    case "workflow_step": {
      const stepName = asString(fact.payload.stepName);
      if (stepName === undefined) return null;
      return { id: stepName, kind: "WorkflowStep", label: stepName };
    }
    case "quality_gate": {
      const tool = asString(fact.payload.tool);
      if (tool === undefined) return null;
      return { id: tool, kind: "QualityGate", label: tool };
    }
    default:
      return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
