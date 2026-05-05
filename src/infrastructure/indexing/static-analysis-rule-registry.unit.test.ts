import { describe, expect, it } from "vitest";

import { StaticAnalysisRuleRegistry } from "./static-analysis-rule-registry.js";

describe("StaticAnalysisRuleRegistry", () => {
  it("returns Milestone 4.1 rule metadata", async () => {
    const rules = await new StaticAnalysisRuleRegistry().list();

    expect(rules.map((rule) => rule.kind)).toEqual([
      "traversal",
      "impact",
      "slice",
    ]);
    expect(rules.every((rule) => rule.version === "milestone-4.1")).toBe(true);
  });
});
