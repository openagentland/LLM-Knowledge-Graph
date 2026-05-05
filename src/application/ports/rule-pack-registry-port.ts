import type { RulePack } from "../dto/overlay.js";

export interface RulePackRegistryPort {
  list(): Promise<RulePack[]>;
}
