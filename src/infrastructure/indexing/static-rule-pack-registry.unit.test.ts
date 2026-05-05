import { describe, expect, it } from "vitest";

import { StaticRulePackRegistry } from "./static-rule-pack-registry.js";

describe("StaticRulePackRegistry", () => {
  it("returns the TS/JS overlay pack", async () => {
    const packs = await new StaticRulePackRegistry().list();

    expect(packs).toEqual([
      expect.objectContaining({
        costProfile: "low",
        id: "ts-js-milestone-4.1",
        supportedLanguages: ["ts", "js"],
        version: "milestone-4.1",
      }),
    ]);
  });
});
