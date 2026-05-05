import type { AnalysisRule } from "../../application/dto/overlay.js";
import type { AnalysisRuleRegistryPort } from "../../application/ports/analysis-rule-registry-port.js";

const RULES: AnalysisRule[] = [
  {
    defaultPrecision: "derived",
    id: "flow-derived-relations",
    kind: "traversal",
    requiredFacts: [
      "caller-callee-candidate",
      "file-imports-file",
      "file-imports-package",
    ],
    requiredOverlays: ["cfg", "pdg_lite"],
    version: "milestone-4.1",
  },
  {
    defaultPrecision: "possible",
    id: "impact-derived-relations",
    kind: "impact",
    requiredFacts: [
      "caller-callee-candidate",
      "quality-gate-runs-script-candidate",
      "workflow-runs-package-script-candidate",
    ],
    requiredOverlays: ["cfg", "pdg_lite"],
    version: "milestone-4.1",
  },
  {
    defaultPrecision: "possible",
    id: "slice-derived-relations",
    kind: "slice",
    requiredFacts: [
      "caller-callee-candidate",
      "symbol-references-symbol-candidate",
      "file-imports-file",
    ],
    requiredOverlays: ["cfg", "data_flow", "pdg_lite"],
    version: "milestone-4.1",
  },
];

export class StaticAnalysisRuleRegistry implements AnalysisRuleRegistryPort {
  list(): Promise<AnalysisRule[]> {
    return Promise.resolve(RULES);
  }
}
