import { glob } from "glob";
import ignore, { type Ignore } from "ignore";
import { stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import type {
  ScanCandidate,
  ScanResult,
  SourceType,
} from "../../application/dto/ingestion.js";
import type { FileScannerPort } from "../../application/ports/file-scanner-port.js";

const DEFAULT_INTERNAL_IGNORES = [
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
    const matcher = ignore();
    matcher.add(this.options.gitignore);
    matcher.add(this.options.internalIgnores ?? DEFAULT_INTERNAL_IGNORES);

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

      if (isIgnored(path, matcher)) {
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

      if (
        stats.size > this.options.maxFileSizeBytes &&
        this.options.skipOversizedFiles === true
      ) {
        skipped.push({ path, reason: "too_large" });
        continue;
      }

      candidates.push({
        absolutePath,
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

function isIgnored(path: string, matcher: Ignore): boolean {
  return matcher.ignores(path) || matcher.ignores(`${path}/`);
}

function normalizeRelativePath(cwd: string, absolutePath: string): string {
  const relativePath = relative(resolve(cwd), resolve(absolutePath));
  return relativePath.replace(/\\/g, "/");
}
