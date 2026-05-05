import { glob } from "glob";
import ignore, { type Ignore } from "ignore";
import { stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import type {
  ArtifactKind,
  ScanCandidate,
  ScanResult,
  SourceType,
} from "../../application/dto/ingestion.js";
import type { FileScannerPort } from "../../application/ports/file-scanner-port.js";

export const DEFAULT_INTERNAL_IGNORES = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  ".claude/**",
  "coverage/**",
  "*.log",
];

const DOC_EXTENSIONS = new Set([".md", ".txt"]);
const CODE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".json",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".sh",
  ".swift",
  ".ts",
  ".unknownlang",
]);
const GENERATED_FILE_NAMES = new Set(["package-lock.json"]);
const SCHEMA_FILE_NAMES = new Set(["tsconfig.json"]);

export function createIgnoreMatcher(options: {
  gitignore: string;
  internalIgnores?: string[];
}): Ignore {
  const matcher = ignore();
  matcher.add(options.gitignore);
  matcher.add(options.internalIgnores ?? DEFAULT_INTERNAL_IGNORES);
  return matcher;
}

export function shouldIgnorePath(path: string, matcher: Ignore): boolean {
  return matcher.ignores(path) || matcher.ignores(`${path}/`);
}

export class GlobFileScanner implements FileScannerPort {
  constructor(
    private readonly options: {
      cwd: string;
      gitignore: string;
      internalIgnores?: string[];
      maxFileSizeBytes: number;
      skipOversizedFiles?: boolean;
    },
  ) {}

  async scan(): Promise<ScanResult> {
    const matcher = createIgnoreMatcher({
      gitignore: this.options.gitignore,
      internalIgnores: this.options.internalIgnores,
    });

    const entries = await glob("**/*", {
      absolute: true,
      cwd: this.options.cwd,
      dot: true,
      nodir: false,
      windowsPathsNoEscape: true,
    });

    const candidates: ScanCandidate[] = [];
    const skipped: ScanResult["skipped"] = [];

    for (const absolutePath of entries) {
      const path = normalizeRelativePath(this.options.cwd, absolutePath);
      if (!path) {
        continue;
      }

      if (shouldIgnorePath(path, matcher)) {
        skipped.push({ path, reason: "ignored" });
        continue;
      }

      const stats = await stat(absolutePath);
      if (stats.isDirectory()) {
        skipped.push({ path, reason: "directory" });
        continue;
      }

      const sourceType = classifySourceType(path);
      if (!sourceType) {
        skipped.push({ path, reason: "unsupported" });
        continue;
      }

      const artifactKind = classifyArtifactKind(path, sourceType);

      if (
        stats.size > this.options.maxFileSizeBytes &&
        this.options.skipOversizedFiles === true &&
        shouldSkipOversizedArtifact(artifactKind)
      ) {
        skipped.push({ path, reason: "too_large" });
        continue;
      }

      candidates.push({
        absolutePath,
        artifactKind,
        path,
        sizeBytes: stats.size,
        sourceType,
      });
    }

    return {
      candidates: candidates.sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      skipped,
    };
  }
}

function classifySourceType(path: string): SourceType | null {
  const extension = basename(path).includes(".")
    ? path.slice(path.lastIndexOf(".")).toLowerCase()
    : "";

  if (DOC_EXTENSIONS.has(extension)) {
    return "doc";
  }

  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }

  return null;
}

function classifyArtifactKind(
  path: string,
  sourceType: SourceType,
): ArtifactKind {
  const fileName = basename(path);

  if (sourceType === "doc") {
    return "doc";
  }

  if (GENERATED_FILE_NAMES.has(fileName)) {
    return "lockfile";
  }

  if (path.startsWith(".github/workflows/")) {
    return "workflow";
  }

  if (SCHEMA_FILE_NAMES.has(fileName)) {
    return "schema";
  }

  if (path.startsWith(".devcontainer/") || fileName === ".lintstagedrc.json") {
    return "config";
  }

  if (fileName === "package.json" || fileName === "nx.json") {
    return "config";
  }

  if (fileName.endsWith(".test.ts") || fileName.endsWith(".spec.ts")) {
    return "test";
  }

  if (fileName.endsWith(".sh") || fileName === "bash") {
    return "script";
  }

  return "code";
}

function shouldSkipOversizedArtifact(artifactKind: ArtifactKind): boolean {
  return artifactKind === "lockfile";
}

function normalizeRelativePath(cwd: string, absolutePath: string): string {
  const relativePath = relative(resolve(cwd), resolve(absolutePath));
  return relativePath.replace(/\\/g, "/");
}
