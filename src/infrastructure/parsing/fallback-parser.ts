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

import type {
  ParsedDocument,
  ScanCandidate,
  StructuralCodeBlock,
} from "../../application/dto/ingestion.js";
import type { ParserPort } from "../../application/ports/parser-port.js";

const dynamicLanguagesRegistered = registerLanguages();

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
    const language = resolveLanguage(candidate.path);

    return {
      content,
      language,
      path: candidate.path,
      sourceType: candidate.sourceType,
      structuralBlocks:
        candidate.sourceType === "code"
          ? parseStructuralBlocks(language, content)
          : undefined,
    };
  }
}

function parseStructuralBlocks(
  language: string | null,
  content: string,
): StructuralCodeBlock[] | undefined {
  if (language === null) {
    return undefined;
  }

  try {
    const astLanguage = STATIC_LANG_BY_EXTENSION[language] ?? language;
    const root = parse(astLanguage, content).root();
    const blocks = collectDeclarationBlocks(root)
      .map((node) => ({
        content: node.text().trim(),
        kind: String(node.kind()),
        location: {
          endLine: node.range().end.line + 1,
          startLine: node.range().start.line + 1,
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
