import type { AnalysisRule } from "../dto/overlay.js";

export interface AnalysisRuleRegistryPort {
  list(): Promise<AnalysisRule[]>;
}
