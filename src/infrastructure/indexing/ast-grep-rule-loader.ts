import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  LanguageCapability,
  StructuredObservationKind,
} from "../../application/dto/structured-observations.js";

export type AstGrepRuleDefinition = {
  id: string;
  kind: StructuredObservationKind;
  matcher: string;
  confidence?: number;
  symbolKind?: string;
};

export type AstGrepRuleSet = {
  language: string;
  moduleMatchers?: string[];
  rules: AstGrepRuleDefinition[];
};

const DEFAULT_RULE_SETS = new Map<string, AstGrepRuleSet>([
  [
    "ts",
    {
      language: "ts",
      moduleMatchers: ["program"],
      rules: [
        {
          confidence: 0.95,
          id: "ts.function",
          kind: "symbol_definition",
          matcher: "function_declaration",
          symbolKind: "function",
        },
        {
          confidence: 0.95,
          id: "ts.class",
          kind: "symbol_definition",
          matcher: "class_declaration",
          symbolKind: "class",
        },
        {
          confidence: 0.9,
          id: "ts.interface",
          kind: "symbol_definition",
          matcher: "interface_declaration",
          symbolKind: "interface",
        },
        {
          confidence: 0.9,
          id: "ts.type",
          kind: "symbol_definition",
          matcher: "type_alias_declaration",
          symbolKind: "type",
        },
        {
          confidence: 0.9,
          id: "ts.enum",
          kind: "symbol_definition",
          matcher: "enum_declaration",
          symbolKind: "enum",
        },
        {
          confidence: 0.85,
          id: "ts.variable",
          kind: "symbol_definition",
          matcher: "lexical_declaration",
          symbolKind: "variable",
        },
        {
          confidence: 0.85,
          id: "ts.import",
          kind: "import",
          matcher: "import_statement",
        },
        {
          confidence: 0.65,
          id: "ts.call",
          kind: "call",
          matcher: "call_expression",
        },
        {
          confidence: 0.55,
          id: "ts.reference",
          kind: "reference",
          matcher: "identifier",
        },
      ],
    },
  ],
  [
    "js",
    {
      language: "js",
      moduleMatchers: ["program"],
      rules: [
        {
          confidence: 0.95,
          id: "js.function",
          kind: "symbol_definition",
          matcher: "function_declaration",
          symbolKind: "function",
        },
        {
          confidence: 0.95,
          id: "js.class",
          kind: "symbol_definition",
          matcher: "class_declaration",
          symbolKind: "class",
        },
        {
          confidence: 0.85,
          id: "js.variable",
          kind: "symbol_definition",
          matcher: "lexical_declaration",
          symbolKind: "variable",
        },
        {
          confidence: 0.85,
          id: "js.import",
          kind: "import",
          matcher: "import_statement",
        },
        {
          confidence: 0.65,
          id: "js.call",
          kind: "call",
          matcher: "call_expression",
        },
        {
          confidence: 0.55,
          id: "js.reference",
          kind: "reference",
          matcher: "identifier",
        },
      ],
    },
  ],
  [
    "py",
    {
      language: "py",
      moduleMatchers: ["module"],
      rules: [
        {
          confidence: 0.95,
          id: "py.function",
          kind: "symbol_definition",
          matcher: "function_definition",
          symbolKind: "function",
        },
        {
          confidence: 0.95,
          id: "py.class",
          kind: "symbol_definition",
          matcher: "class_definition",
          symbolKind: "class",
        },
        {
          confidence: 0.85,
          id: "py.import",
          kind: "import",
          matcher: "import_statement",
        },
        {
          confidence: 0.65,
          id: "py.call",
          kind: "call",
          matcher: "call",
        },
        {
          confidence: 0.55,
          id: "py.reference",
          kind: "reference",
          matcher: "identifier",
        },
      ],
    },
  ],
]);

export class AstGrepRuleLoader {
  async load(capability: LanguageCapability | null): Promise<AstGrepRuleSet | null> {
    if (capability === null) {
      return null;
    }

    const defaultRuleSet = DEFAULT_RULE_SETS.get(capability.id) ?? null;
    if (defaultRuleSet === null) {
      return null;
    }

    const override = await this.tryReadOverride(capability.id);
    return override ?? defaultRuleSet;
  }

  private async tryReadOverride(languageId: string): Promise<AstGrepRuleSet | null> {
    const path = resolve(process.cwd(), ".lkg", "ast-grep", `${languageId}.json`);

    try {
      const content = await readFile(path, "utf8");
      return JSON.parse(content) as AstGrepRuleSet;
    } catch {
      return null;
    }
  }
}

export async function ensureAstGrepRuleDirectory(cwd: string): Promise<string> {
  const directory = resolve(cwd, ".lkg", "ast-grep");
  await mkdir(dirname(resolve(directory, "placeholder")), { recursive: true });
  return directory;
}
