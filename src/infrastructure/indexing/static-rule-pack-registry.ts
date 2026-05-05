import type { RulePack } from "../../application/dto/overlay.js";
import type { RulePackRegistryPort } from "../../application/ports/rule-pack-registry-port.js";

const RULE_PACKS: RulePack[] = [
  {
    costProfile: "low",
    id: "ts-js-milestone-4.1",
    requiredOverlays: ["cfg", "data_flow", "pdg_lite"],
    supportedLanguages: ["ts", "js"],
    version: "milestone-4.1",
  },
];

export class StaticRulePackRegistry implements RulePackRegistryPort {
  list(): Promise<RulePack[]> {
    return Promise.resolve(RULE_PACKS);
  }
}
